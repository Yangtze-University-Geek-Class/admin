import { useEffect, useState } from "react";

export const PHONE_QUERY = "(max-width: 860px), (pointer: coarse) and (max-width: 1024px) and (max-height: 600px)";
export const PORTRAIT_QUERY = "(orientation: portrait)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
