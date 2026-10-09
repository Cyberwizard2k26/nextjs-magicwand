import * as React from "react";
import { DeviceConsole } from "@/components/remote/console";
export const metadata = { title: "Console" };
export default function Page() { return <React.Suspense><DeviceConsole /></React.Suspense>; }
