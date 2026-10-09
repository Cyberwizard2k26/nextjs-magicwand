//go:build !windows

package commands

import "context"

func RegistryList(ctx context.Context, c *Command) (interface{}, error)   { return nil, unsupported("the registry") }
func RegistryGet(ctx context.Context, c *Command) (interface{}, error)    { return nil, unsupported("the registry") }
func RegistrySet(ctx context.Context, c *Command) (interface{}, error)    { return nil, unsupported("the registry") }
func RegistryDelete(ctx context.Context, c *Command) (interface{}, error) { return nil, unsupported("the registry") }
