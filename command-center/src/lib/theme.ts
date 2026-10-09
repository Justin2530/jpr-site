export type Theme = "jarvis" | "matrix" | "classic";

// The look saved in the jpr-theme cookie; JARVIS unless another one was picked.
export function themeFrom(cookie: string | undefined): Theme {
  return cookie === "matrix" || cookie === "classic" ? cookie : "jarvis";
}
