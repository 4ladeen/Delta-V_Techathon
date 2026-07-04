/**
 * Team Delta V — Drishti (দৃষ্টি) — ESP32 IoT Firmware
 * =========================================
 * Hardware (matches docs/diagram.json exactly):
 *   PIR sensors   : GPIO4 (Drawing Room), GPIO5 (Work Room 1), GPIO15 (Work Room 2)
 *   Relay modules : GPIO16 (Drawing Room), GPIO17 (Work Room 1), GPIO18 (Work Room 2)
 *   DHT22         : GPIO19 (data line)
 *   OLED SSD1306  : I2C — SDA=GPIO21, SCL=GPIO22 (128×64)
 *   Status LEDs   : GPIO13 (Drawing Room), GPIO14 (Work Room 1), GPIO27 (Work Room 2)
 *   Alarm LED     : GPIO26
 *   Buzzer        : GPIO23
 *   Manual Button : GPIO25 (pull-up via 10kΩ to 3V3, other end to GND)
 *
 * What it does:
 *   1. Reads PIR occupancy — triggers relay + status LED for each room
 *   2. Reads DHT22 every 10 s — temperature & humidity to OLED and backend
 *   3. Every 5 s: POST /api/iot/sensor  → reports occupancy + environment
 *   4. Every 5 s: GET  /api/iot/relays  → receives desired relay states from backend
 *   5. Manual Override button: cycles through AUTO / FORCE-ON / FORCE-OFF modes
 *   6. Alarm LED + buzzer pulse when backend reports active critical alerts
 *   7. OLED shows: IP, time, per-room occupancy, temp/humidity, mode, alert count
 *
 * Libraries required (install via Arduino Library Manager):
 *   - WiFi (built-in ESP32 core)
 *   - HTTPClient (built-in ESP32 core)
 *   - ArduinoJson  >= 6.x   (Benoit Blanchon)
 *   - Adafruit SSD1306      (Adafruit)
 *   - Adafruit GFX Library  (Adafruit)
 *   - DHT sensor library    (Adafruit)
 *   - Adafruit Unified Sensor (Adafruit)
 *
 * Wokwi simulation: works without real WiFi — backend URL is configurable.
 * Set WOKWI_SIM to 1 to skip real HTTP calls and echo to Serial instead.
 */

// ─── Compile-time config ──────────────────────────────────────────────────────
#define WOKWI_SIM       1            // 1 = simulation mode (no real HTTP)
#define WIFI_SSID       "YourSSID"
#define WIFI_PASS       "YourPassword"
#define BACKEND_URL     "http://192.168.1.100:8000"   // change to your server IP
#define DEVICE_ID       "esp32-office-01"

// ─── Libraries ───────────────────────────────────────────────────────────────
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

// ─── Pin definitions (must match diagram.json) ───────────────────────────────
// PIR sensors
#define PIR_DRAWING     4
#define PIR_WORK1       5
#define PIR_WORK2       15

// Relay outputs (LOW = energise for most relay modules)
#define RELAY_DRAWING   16
#define RELAY_WORK1     17
#define RELAY_WORK2     18

// DHT22
#define DHT_PIN         19
#define DHT_TYPE        DHT22

// OLED (I2C)
#define OLED_SDA        21
#define OLED_SCL        22
#define OLED_WIDTH      128
#define OLED_HEIGHT     64
#define OLED_RESET      -1
#define OLED_I2C_ADDR   0x3C

// Status LEDs
#define LED_DRAWING     13
#define LED_WORK1       14
#define LED_WORK2       27

// Alarm
#define LED_ALARM       26
#define BUZZER_PIN      23

// Manual override button
#define BTN_PIN         25

// ─── Constants ───────────────────────────────────────────────────────────────
#define SENSOR_INTERVAL_MS    5000UL    // push sensor data every 5 s
#define RELAY_POLL_MS         5000UL    // poll backend for relay commands every 5 s
#define DHT_READ_INTERVAL_MS  10000UL   // DHT22 read every 10 s
#define OLED_REFRESH_MS       1000UL    // OLED refresh every 1 s
#define PIR_HOLD_MS           30000UL   // keep room "occupied" 30 s after last trigger
#define BUZZER_DURATION_MS    120       // short beep length
#define DEBOUNCE_MS           50        // button debounce

// ─── Override modes ──────────────────────────────────────────────────────────
enum OverrideMode { AUTO = 0, FORCE_ON = 1, FORCE_OFF = 2 };
const char* MODE_LABELS[] = { "AUTO", "FORCE ON", "FORCE OFF" };

// ─── Globals ─────────────────────────────────────────────────────────────────
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
DHT dht(DHT_PIN, DHT_TYPE);

// PIR state
bool pirState[3]        = { false, false, false };
unsigned long lastPirTime[3] = { 0, 0, 0 };

// Relay desired state from backend
bool relayDesired[3]    = { false, false, false };

// Sensor readings
float temperature       = 0.0f;
float humidity          = 0.0f;

// Alert state
int activeAlerts        = 0;

// Override mode
OverrideMode overrideMode = AUTO;

// Timers
unsigned long lastSensorPost  = 0;
unsigned long lastRelayPoll   = 0;
unsigned long lastDhtRead     = 0;
unsigned long lastOledRefresh = 0;

// Button debounce
unsigned long lastBtnPress    = 0;
bool lastBtnState             = HIGH;

// WiFi / HTTP state
bool wifiConnected            = false;

// ─── Forward declarations ─────────────────────────────────────────────────────
void connectWiFi();
void readPIRSensors();
void readDHT();
void applyRelays();
void postSensorData();
void pollRelayCommands();
void updateOLED();
void handleButton();
void beep(int count, int delayMs = 100);
void setAlarmState(bool on);
String getRoomId(int idx);

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n╔════════════════════════════╗"));
  Serial.println(F("║  Drishti ESP32 Firmware    ║"));
  Serial.println(F("╚════════════════════════════╝"));

  // PIR inputs
  pinMode(PIR_DRAWING, INPUT);
  pinMode(PIR_WORK1,   INPUT);
  pinMode(PIR_WORK2,   INPUT);

  // Relays — start de-energised (HIGH for most active-low relay boards)
  pinMode(RELAY_DRAWING, OUTPUT); digitalWrite(RELAY_DRAWING, HIGH);
  pinMode(RELAY_WORK1,   OUTPUT); digitalWrite(RELAY_WORK1,   HIGH);
  pinMode(RELAY_WORK2,   OUTPUT); digitalWrite(RELAY_WORK2,   HIGH);

  // Status LEDs
  pinMode(LED_DRAWING, OUTPUT); digitalWrite(LED_DRAWING, LOW);
  pinMode(LED_WORK1,   OUTPUT); digitalWrite(LED_WORK1,   LOW);
  pinMode(LED_WORK2,   OUTPUT); digitalWrite(LED_WORK2,   LOW);

  // Alarm
  pinMode(LED_ALARM, OUTPUT); digitalWrite(LED_ALARM, LOW);
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW);

  // Button — external pull-up via R5 (10kΩ), reads LOW when pressed
  pinMode(BTN_PIN, INPUT);

  // DHT22
  dht.begin();

  // I2C + OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println(F("[oled] SSD1306 init FAILED — check wiring"));
    // Don't halt; still function without display
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("Drishti (drishti)"));
    display.println(F("Booting..."));
    display.display();
  }

  // Startup beep
  beep(2, 80);

#if !WOKWI_SIM
  connectWiFi();
#else
  Serial.println(F("[wifi] Simulation mode — WiFi skipped"));
  wifiConnected = true;
#endif

  Serial.println(F("[boot] Setup complete"));
}

// ─── Main loop ───────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  handleButton();
  readPIRSensors();

  // DHT read (slow sensor — don't read every loop)
  if (now - lastDhtRead >= DHT_READ_INTERVAL_MS) {
    lastDhtRead = now;
    readDHT();
  }

  // Apply relays based on current mode + PIR / backend commands
  applyRelays();

  // Periodic backend POST
  if (wifiConnected && (now - lastSensorPost >= SENSOR_INTERVAL_MS)) {
    lastSensorPost = now;
    postSensorData();
  }

  // Periodic relay poll
  if (wifiConnected && (now - lastRelayPoll >= RELAY_POLL_MS)) {
    lastRelayPoll = now;
    pollRelayCommands();
  }

  // OLED refresh
  if (now - lastOledRefresh >= OLED_REFRESH_MS) {
    lastOledRefresh = now;
    updateOLED();
  }

  // Alarm LED blink when alerts exist
  if (activeAlerts > 0) {
    // Slow blink 500ms on/off
    bool blinkOn = (now / 500) % 2 == 0;
    digitalWrite(LED_ALARM, blinkOn ? HIGH : LOW);
  } else {
    digitalWrite(LED_ALARM, LOW);
  }

  delay(10); // yield
}

// ─── WiFi ────────────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[wifi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(F("Connecting WiFi..."));
  display.println(WIFI_SSID);
  display.display();

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print('.');
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.printf("\n[wifi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    beep(3, 60);
  } else {
    wifiConnected = false;
    Serial.println(F("\n[wifi] Failed — running offline"));
    beep(1, 500); // long beep = error
  }
}

// ─── PIR Sensors ─────────────────────────────────────────────────────────────
void readPIRSensors() {
  const int pirPins[] = { PIR_DRAWING, PIR_WORK1, PIR_WORK2 };
  unsigned long now = millis();

  for (int i = 0; i < 3; i++) {
    bool triggered = digitalRead(pirPins[i]) == HIGH;
    if (triggered) {
      if (!pirState[i]) {
        Serial.printf("[pir] Motion detected in %s\n", getRoomId(i).c_str());
      }
      pirState[i]    = true;
      lastPirTime[i] = now;
    } else {
      // Hold "occupied" for PIR_HOLD_MS after last trigger
      if (pirState[i] && (now - lastPirTime[i] > PIR_HOLD_MS)) {
        pirState[i] = false;
        Serial.printf("[pir] %s went unoccupied\n", getRoomId(i).c_str());
      }
    }
  }
}

// ─── DHT22 ───────────────────────────────────────────────────────────────────
void readDHT() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity    = h;
    Serial.printf("[dht] Temp: %.1f°C  Humidity: %.1f%%\n", temperature, humidity);
  } else {
    Serial.println(F("[dht] Read failed — using last values"));
  }
}

// ─── Relay control ───────────────────────────────────────────────────────────
// Relay modules are active-LOW: LOW = coil energised = device ON
void applyRelays() {
  const int relayPins[] = { RELAY_DRAWING, RELAY_WORK1, RELAY_WORK2 };
  const int ledPins[]   = { LED_DRAWING,   LED_WORK1,   LED_WORK2   };

  for (int i = 0; i < 3; i++) {
    bool shouldBeOn;

    switch (overrideMode) {
      case FORCE_ON:
        shouldBeOn = true;
        break;
      case FORCE_OFF:
        shouldBeOn = false;
        break;
      case AUTO:
      default:
        // In AUTO: combine PIR occupancy with backend relay command
        // Backend says ON  → use backend
        // Backend says OFF → also OFF (backend is authoritative in AUTO)
        // If backend hasn't replied yet → fall back to PIR only
        shouldBeOn = relayDesired[i] || pirState[i];
        break;
    }

    // Active-LOW relay board: LOW = ON, HIGH = OFF
    digitalWrite(relayPins[i], shouldBeOn ? LOW : HIGH);
    // Status LED mirrors relay
    digitalWrite(ledPins[i], shouldBeOn ? HIGH : LOW);
  }
}

// ─── POST /api/iot/sensor ────────────────────────────────────────────────────
void postSensorData() {
#if WOKWI_SIM
  Serial.printf("[sim-post] occupancy=[%d,%d,%d] temp=%.1f hum=%.1f alerts=%d\n",
    pirState[0], pirState[1], pirState[2], temperature, humidity, activeAlerts);
  return;
#endif

  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    connectWiFi();
    return;
  }

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/iot/sensor";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["deviceId"]    = DEVICE_ID;
  doc["temperature"] = temperature;
  doc["humidity"]    = humidity;

  JsonArray occ = doc.createNestedArray("occupancy");
  occ.add(pirState[0]); // drawing_room
  occ.add(pirState[1]); // work_room_1
  occ.add(pirState[2]); // work_room_2

  JsonArray relays = doc.createNestedArray("relays");
  relays.add(digitalRead(RELAY_DRAWING) == LOW);
  relays.add(digitalRead(RELAY_WORK1)   == LOW);
  relays.add(digitalRead(RELAY_WORK2)   == LOW);

  doc["mode"] = MODE_LABELS[overrideMode];

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200 || httpCode == 201) {
    // Parse response for any immediate commands
    String resp = http.getString();
    StaticJsonDocument<128> respDoc;
    if (deserializeJson(respDoc, resp) == DeserializationError::Ok) {
      activeAlerts = respDoc["activeAlerts"] | 0;
    }
    Serial.printf("[http] POST /api/iot/sensor -> %d\n", httpCode);
  } else {
    Serial.printf("[http] POST /api/iot/sensor FAILED: %d\n", httpCode);
  }

  http.end();
}

// ─── GET /api/iot/relays ─────────────────────────────────────────────────────
void pollRelayCommands() {
#if WOKWI_SIM
  // In simulation, auto-mirror PIR for testing
  for (int i = 0; i < 3; i++) relayDesired[i] = pirState[i];
  return;
#endif

  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/iot/relays?deviceId=" + DEVICE_ID;
  http.begin(url);
  http.setTimeout(4000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (!err) {
      // Expected: { "relays": [bool, bool, bool], "activeAlerts": N }
      JsonArray relays = doc["relays"].as<JsonArray>();
      if (relays.size() >= 3) {
        relayDesired[0] = relays[0].as<bool>();
        relayDesired[1] = relays[1].as<bool>();
        relayDesired[2] = relays[2].as<bool>();
      }
      activeAlerts = doc["activeAlerts"] | 0;

      if (activeAlerts > 0 && overrideMode == AUTO) {
        // One-shot alarm beep when new alerts appear
        static int lastAlertCount = 0;
        if (activeAlerts > lastAlertCount) {
          beep(activeAlerts > 2 ? 3 : 1, 80);
        }
        lastAlertCount = activeAlerts;
      }

      Serial.printf("[http] GET /api/iot/relays -> relays=[%d,%d,%d] alerts=%d\n",
        relayDesired[0], relayDesired[1], relayDesired[2], activeAlerts);
    }
  } else {
    Serial.printf("[http] GET /api/iot/relays FAILED: %d\n", httpCode);
  }

  http.end();
}

// ─── OLED Display ─────────────────────────────────────────────────────────────
//
//  Line 0: "Drishti  [mode]"
//  Line 1: IP address (or "Offline")
//  Line 2: "T:24.3C  H:62%"
//  Line 3: "DR:[M] W1:[M] W2:[M]"  (M=motion dot, blank=empty)
//  Line 4: "Relays: ON OFF ON"
//  Line 5: "[N] Active Alerts ⚠" | "No Alerts ✓"
//
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Row 0 — title + mode
  display.setCursor(0, 0);
  display.print(F("Drishti "));
  display.print(MODE_LABELS[overrideMode]);

  // Row 1 — connectivity
  display.setCursor(0, 10);
  if (wifiConnected) {
#if !WOKWI_SIM
    display.print(WiFi.localIP().toString());
#else
    display.print(F("SIM MODE"));
#endif
  } else {
    display.print(F("WiFi: Offline"));
  }

  // Row 2 — temperature & humidity
  display.setCursor(0, 20);
  display.printf("T:%.1fC  H:%.0f%%", temperature, humidity);

  // Row 3 — occupancy (PIR)
  display.setCursor(0, 30);
  display.print(F("DR:"));
  display.print(pirState[0] ? '*' : '-');
  display.print(F(" W1:"));
  display.print(pirState[1] ? '*' : '-');
  display.print(F(" W2:"));
  display.print(pirState[2] ? '*' : '-');

  // Row 4 — relay actual states
  display.setCursor(0, 40);
  display.print(F("Relay:"));
  for (int i = 0; i < 3; i++) {
    const int relayPins[] = { RELAY_DRAWING, RELAY_WORK1, RELAY_WORK2 };
    bool on = digitalRead(relayPins[i]) == LOW;
    display.print(on ? F(" ON") : F(" --"));
  }

  // Row 5 — alerts
  display.setCursor(0, 54);
  if (activeAlerts > 0) {
    display.printf("! %d Alert%s Active", activeAlerts, activeAlerts > 1 ? "s" : "");
  } else {
    display.print(F("All Clear"));
  }

  display.display();
}

// ─── Manual Override Button ───────────────────────────────────────────────────
// Press: cycles AUTO → FORCE_ON → FORCE_OFF → AUTO
// Relies on external 10kΩ pull-up to 3V3 (R5 in diagram)
void handleButton() {
  bool currentState = digitalRead(BTN_PIN);
  unsigned long now = millis();

  // Detect falling edge (press down)
  if (lastBtnState == HIGH && currentState == LOW) {
    if (now - lastBtnPress > DEBOUNCE_MS) {
      lastBtnPress = now;
      overrideMode = (OverrideMode)((overrideMode + 1) % 3);
      Serial.printf("[btn] Override mode → %s\n", MODE_LABELS[overrideMode]);
      beep(overrideMode + 1, 60); // 1 beep = AUTO, 2 = FORCE_ON, 3 = FORCE_OFF
    }
  }
  lastBtnState = currentState;
}

// ─── Buzzer helper ───────────────────────────────────────────────────────────
void beep(int count, int gapMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(BUZZER_DURATION_MS);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < count - 1) delay(gapMs);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────
String getRoomId(int idx) {
  switch (idx) {
    case 0: return "drawing_room";
    case 1: return "work_room_1";
    case 2: return "work_room_2";
    default: return "unknown";
  }
}