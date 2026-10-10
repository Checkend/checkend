import pkg from "../../package.json" with { type: "json" };

/** The Checkend version, from package.json. */
export const VERSION: string = pkg.version;
