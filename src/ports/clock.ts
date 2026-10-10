/** The current time. Inject it so that tests can control time. */
export interface Clock {
	now(): Date;
}
