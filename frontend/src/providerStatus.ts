export type ProviderTone = "ok" | "check" | "warning";

export type UserFacingProviderStatus = {
  label: string;
  detail: string;
  tone: ProviderTone;
};

const time = (value?: string) => value
  ? new Date(value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  : null;

export function getUserFacingProviderStatus(state?: string, updatedAt?: string): UserFacingProviderStatus {
  const updated = time(updatedAt);
  switch ((state || "UNAVAILABLE").toUpperCase()) {
    case "LIVE":
    case "READY":
    case "OK":
      return { label: updated ? `Aggiornato alle ${updated}` : "Aggiornato ora", detail: "Dati ricevuti correttamente", tone: "ok" };
    case "CACHE":
    case "OFFLINE":
      return { label: "Dati recenti salvati", detail: updated ? `Aggiornati alle ${updated}` : "Ultimo aggiornamento disponibile", tone: "check" };
    case "NOT_CONFIGURED":
    case "NOT_IMPLEMENTED":
      return { label: "Non disponibile", detail: "Servizio non ancora attivo", tone: "check" };
    case "ERROR":
      return { label: "Temporaneamente non disponibile", detail: "Riproveremo al prossimo aggiornamento", tone: "warning" };
    default:
      return { label: "Nessun dato rilevante", detail: "Nessun aggiornamento per questa giornata", tone: "check" };
  }
}

