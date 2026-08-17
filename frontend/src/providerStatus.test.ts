import { describe, expect, it } from "vitest";
import { getUserFacingProviderStatus } from "./providerStatus";

describe("provider status presentation", () => {
  it("translates live without implying a live sensor", () => expect(getUserFacingProviderStatus("LIVE").label).toBe("Aggiornato ora"));
  it("presents cached data clearly", () => expect(getUserFacingProviderStatus("CACHE").label).toBe("Dati recenti salvati"));
  it("never exposes configuration enums", () => expect(getUserFacingProviderStatus("NOT_CONFIGURED").label).toBe("Non disponibile"));
  it("handles unavailable data", () => expect(getUserFacingProviderStatus("UNAVAILABLE").label).toBe("Nessun dato rilevante"));
});
