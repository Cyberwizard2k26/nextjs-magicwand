package main

import "encoding/json"

func jsonIndent(v interface{}) ([]byte, error) { return json.MarshalIndent(v, "", "  ") }
