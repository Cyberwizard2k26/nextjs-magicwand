// Package logging is a small leveled logger that writes to stderr and (when configured) a rotating file.
package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Level int

const (
	Debug Level = iota
	Info
	Warn
	Error
)

var (
	mu       sync.Mutex
	minLevel = Info
	out      io.Writer = os.Stderr
	file     *os.File
	filePath string
	maxBytes int64 = 5 * 1024 * 1024
)

func SetLevel(l string) {
	switch l {
	case "debug":
		minLevel = Debug
	case "warn":
		minLevel = Warn
	case "error":
		minLevel = Error
	default:
		minLevel = Info
	}
}

// SetFile enables logging to a file (rotated when it exceeds 5 MB, keeping one backup).
func SetFile(path string) error {
	mu.Lock()
	defer mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	file = f
	filePath = path
	out = io.MultiWriter(os.Stderr, f)
	return nil
}

func rotateIfNeeded() {
	if file == nil {
		return
	}
	st, err := file.Stat()
	if err != nil || st.Size() < maxBytes {
		return
	}
	file.Close()
	_ = os.Rename(filePath, filePath+".1")
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		file = nil
		out = os.Stderr
		return
	}
	file = f
	out = io.MultiWriter(os.Stderr, f)
}

func logf(l Level, name, format string, args ...interface{}) {
	if l < minLevel {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	rotateIfNeeded()
	fmt.Fprintf(out, "%s %-5s %s\n", time.Now().Format("2006-01-02T15:04:05.000Z07:00"), name, fmt.Sprintf(format, args...))
}

func Debugf(f string, a ...interface{}) { logf(Debug, "DEBUG", f, a...) }
func Infof(f string, a ...interface{})  { logf(Info, "INFO", f, a...) }
func Warnf(f string, a ...interface{})  { logf(Warn, "WARN", f, a...) }
func Errorf(f string, a ...interface{}) { logf(Error, "ERROR", f, a...) }
