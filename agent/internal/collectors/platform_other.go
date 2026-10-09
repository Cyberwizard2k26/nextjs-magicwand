//go:build !linux && !windows && !darwin

package collectors

import "github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"

func applyPlatformSystem(s *protocol.SystemInfo)         {}
func applyPlatformHardware(hw map[string]interface{})    {}
func batteryPercent() (float64, bool)                     { return 0, false }
func ConsoleUser() string                                 { return "" }
func Software() []protocol.Software                       { return nil }
func Services() []protocol.Service                        { return nil }
func LocalUsers() []protocol.LocalUser                    { return nil }
func Security() map[string]interface{}                    { return map[string]interface{}{} }
