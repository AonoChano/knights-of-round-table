import { t } from "../../app/locale";

/** The `models` slice of the locale bundle, template helpers included. */
export type ModelsCopy = ReturnType<typeof t>["models"];
