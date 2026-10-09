//go:build windows

package commands

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/sys/windows/registry"
)

var hives = map[string]registry.Key{
	"HKLM": registry.LOCAL_MACHINE, "HKEY_LOCAL_MACHINE": registry.LOCAL_MACHINE,
	"HKCU": registry.CURRENT_USER, "HKEY_CURRENT_USER": registry.CURRENT_USER,
	"HKCR": registry.CLASSES_ROOT, "HKEY_CLASSES_ROOT": registry.CLASSES_ROOT,
	"HKU": registry.USERS, "HKEY_USERS": registry.USERS,
	"HKCC": registry.CURRENT_CONFIG, "HKEY_CURRENT_CONFIG": registry.CURRENT_CONFIG,
}

type regArgs struct {
	Hive  string      `json:"hive"`
	Path  string      `json:"path"`
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

func splitKey(a regArgs) (registry.Key, string, error) {
	hive := strings.ToUpper(strings.TrimSpace(a.Hive))
	path := strings.Trim(strings.ReplaceAll(a.Path, "/", `\`), `\`)
	if hive == "" {
		// Accept "HKLM\SOFTWARE\..." in path.
		if i := strings.Index(path, `\`); i > 0 {
			hive, path = strings.ToUpper(path[:i]), path[i+1:]
		} else {
			hive, path = strings.ToUpper(path), ""
		}
	}
	k, ok := hives[hive]
	if !ok {
		return 0, "", fmt.Errorf("unknown hive %q", a.Hive)
	}
	return k, path, nil
}

type regValue struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

func readValue(k registry.Key, name string) (regValue, error) {
	_, typ, err := k.GetValue(name, nil)
	if err != nil {
		return regValue{}, err
	}
	rv := regValue{Name: name}
	switch typ {
	case registry.SZ, registry.EXPAND_SZ:
		v, _, err := k.GetStringValue(name)
		rv.Type, rv.Value = map[uint32]string{registry.SZ: "string", registry.EXPAND_SZ: "expand"}[typ], v
		return rv, err
	case registry.DWORD, registry.QWORD:
		v, _, err := k.GetIntegerValue(name)
		rv.Type, rv.Value = map[uint32]string{registry.DWORD: "dword", registry.QWORD: "qword"}[typ], v
		return rv, err
	case registry.MULTI_SZ:
		v, _, err := k.GetStringsValue(name)
		rv.Type, rv.Value = "multi", v
		return rv, err
	case registry.BINARY:
		v, _, err := k.GetBinaryValue(name)
		rv.Type, rv.Value = "binary", base64.StdEncoding.EncodeToString(v)
		return rv, err
	default:
		v, _, err := k.GetBinaryValue(name)
		rv.Type, rv.Value = "type"+strconv.Itoa(int(typ)), base64.StdEncoding.EncodeToString(v)
		return rv, err
	}
}

// RegistryList: { hive, path } -> subkeys + values
func RegistryList(ctx context.Context, c *Command) (interface{}, error) {
	var a regArgs
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	root, path, err := splitKey(a)
	if err != nil {
		return nil, err
	}
	k, err := registry.OpenKey(root, path, registry.READ)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer k.Close()
	subs, _ := k.ReadSubKeyNames(-1)
	names, _ := k.ReadValueNames(-1)
	values := make([]regValue, 0, len(names))
	for _, n := range names {
		if v, err := readValue(k, n); err == nil {
			values = append(values, v)
		}
	}
	if subs == nil {
		subs = []string{}
	}
	return map[string]interface{}{"hive": strings.ToUpper(a.Hive), "path": path, "subkeys": subs, "values": values}, nil
}

// RegistryGet: { hive, path, name }
func RegistryGet(ctx context.Context, c *Command) (interface{}, error) {
	var a regArgs
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	root, path, err := splitKey(a)
	if err != nil {
		return nil, err
	}
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return nil, err
	}
	defer k.Close()
	return readValue(k, a.Name)
}

// RegistrySet: { hive, path, name, type: string|expand|dword|qword|multi|binary, value }
func RegistrySet(ctx context.Context, c *Command) (interface{}, error) {
	var a regArgs
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	root, path, err := splitKey(a)
	if err != nil {
		return nil, err
	}
	k, _, err := registry.CreateKey(root, path, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return nil, err
	}
	defer k.Close()
	switch strings.ToLower(a.Type) {
	case "string", "":
		err = k.SetStringValue(a.Name, fmt.Sprint(a.Value))
	case "expand":
		err = k.SetExpandStringValue(a.Name, fmt.Sprint(a.Value))
	case "dword":
		n, perr := toUint(a.Value)
		if perr != nil {
			return nil, perr
		}
		err = k.SetDWordValue(a.Name, uint32(n))
	case "qword":
		n, perr := toUint(a.Value)
		if perr != nil {
			return nil, perr
		}
		err = k.SetQWordValue(a.Name, n)
	case "multi":
		var parts []string
		switch v := a.Value.(type) {
		case []interface{}:
			for _, x := range v {
				parts = append(parts, fmt.Sprint(x))
			}
		default:
			parts = strings.Split(fmt.Sprint(v), "\n")
		}
		err = k.SetStringsValue(a.Name, parts)
	case "binary":
		b, derr := base64.StdEncoding.DecodeString(fmt.Sprint(a.Value))
		if derr != nil {
			return nil, errors.New("binary values must be base64")
		}
		err = k.SetBinaryValue(a.Name, b)
	default:
		return nil, fmt.Errorf("unknown value type %q", a.Type)
	}
	if err != nil {
		return nil, err
	}
	return readValue(k, a.Name)
}

// RegistryDelete: { hive, path, name? } - deletes a value, or the whole key (recursively) when name is empty.
func RegistryDelete(ctx context.Context, c *Command) (interface{}, error) {
	var a regArgs
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	root, path, err := splitKey(a)
	if err != nil {
		return nil, err
	}
	if a.Name != "" {
		k, err := registry.OpenKey(root, path, registry.SET_VALUE)
		if err != nil {
			return nil, err
		}
		defer k.Close()
		if err := k.DeleteValue(a.Name); err != nil {
			return nil, err
		}
		return map[string]interface{}{"deleted": a.Name}, nil
	}
	if path == "" || len(strings.Split(path, `\`)) < 2 {
		return nil, errors.New("refusing to delete a top-level key")
	}
	if err := deleteKeyRecursive(root, path); err != nil {
		return nil, err
	}
	return map[string]interface{}{"deleted": path}, nil
}

func deleteKeyRecursive(root registry.Key, path string) error {
	k, err := registry.OpenKey(root, path, registry.READ)
	if err != nil {
		return err
	}
	subs, _ := k.ReadSubKeyNames(-1)
	k.Close()
	for _, s := range subs {
		if err := deleteKeyRecursive(root, path+`\`+s); err != nil {
			return err
		}
	}
	return registry.DeleteKey(root, path)
}

func toUint(v interface{}) (uint64, error) {
	switch t := v.(type) {
	case float64:
		return uint64(t), nil
	case string:
		t = strings.TrimSpace(t)
		if strings.HasPrefix(strings.ToLower(t), "0x") {
			return strconv.ParseUint(t[2:], 16, 64)
		}
		return strconv.ParseUint(t, 10, 64)
	}
	return 0, fmt.Errorf("value must be a number")
}
