import { processCpuClock } from "../../src/adapters/node/cpu-clock.ts";
import { cpuClockContract } from "../contract/cpu-clock-contract.ts";

cpuClockContract("process.cpuUsage (Node)", processCpuClock);
