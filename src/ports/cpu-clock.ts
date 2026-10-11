/**
 * The CPU time of this process, in milliseconds. The ReDoS check of scrub patterns uses it on
 * Node, so that a busy machine (other processes) cannot make a fast pattern look slow. Workers
 * have none (null): there the check uses the clock between I/O calls.
 */
export interface CpuClock {
	now(): number;
}
