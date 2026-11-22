// generated: sha256=d9223f8603d1fa18d72c62bb4a31ae1466c1889cae5d4febe4e182031a615813 from=gaddi-mark-art.ts
// The Gaddi mark: the pixel-art head of a Gaddi dog. Fork-only (FORK.md, "Gaddi brand"): upstream's
// generated orbit mark is ColliePWA's logo, which its TRADEMARKS.md keeps out of a fork.
//
//   <CollieMark size={132} />                            the mark
//   <CollieMark size={132} state="loading" />            while something is fetching
//   <CollieMark size={40} weight="header" />             below about 80px
//
// Implements mark-contract.ts so every host (header, splash, idle lock, tour, theme preview) and
// the mark conformance suite drive it through the same props, CSS variables and imperative handle.
//
// LOADING IS A COLOUR AS WELL AS A MOVE. The head trots (a short hop) and its outline takes the
// accent or forced bead colour. Under `prefers-reduced-motion` the hop stops and the colour still
// says what state the mark is in.

import { useMemo, type ComponentType } from "react";

import { GADDI_HEAD, GADDI_OUTLINE, GADDI_VIEW } from "./gaddi-mark-art";
import { MARK_STYLE, useMark, type MarkProps, type MarkSpec } from "./mark-contract";

// A <style> inside an inline SVG is document-scoped, so the rules are shared by every instance and
// everything that varies per instance is a custom property on the element.
const STYLE =
  MARK_STYLE +
  "@keyframes cm-trot{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}" +
  ".cm-live .cm-head,.cm-drift .cm-head{animation:cm-trot var(--cm-turn) steps(2) infinite}" +
  ".cm-line{fill:var(--mark-bead-0, var(--mark-bead, var(--cm-a1, var(--mark-ink, currentColor))))}" +
  "@media (prefers-reduced-motion:reduce){.cm-head{animation:none!important}}";

const MARKUP = `<g shape-rendering="crispEdges"><g class="cm-line">${GADDI_OUTLINE}</g><g class="cm-head">${GADDI_HEAD}</g></g>`;

const VIEW = { full: GADDI_VIEW, header: "0 4 60 52" };

const SPEC: Omit<MarkSpec, "id"> = {
  beads: 8,
  paced: /^cm-/,
  liveClass: "cm-live",
  look: {
    rest: { "--cm-a1": "oklch(0.96 0 0)", "--cm-a2": "oklch(0.82 0 0)" },
    live: { "--cm-a1": "oklch(0.68 0 0)", "--cm-a2": "oklch(0.58 0 0)" },
  },
  accents: ["--cm-a1", "--cm-a2"],
  turnVar: "--cm-turn",
  paperVar: "--cm-paper",
  view: VIEW,
};

export type CollieMarkProps = MarkProps;

// Theme IDs remain compatible with upstream themes. Every variant draws the fork's own art.
function variantOpacity(id: string): string {
  if (id === "collie-collar") return "0.82";
  if (id === "collie-blaze") return "0.65";
  return "1";
}

export function collieFamilyMark(id: string, _head: string): ComponentType<CollieMarkProps> {
  const spec: MarkSpec = { ...SPEC, id };
  const markup = MARKUP.replace('<g class="cm-line">', `<g class="cm-line" opacity="${variantOpacity(id)}">`);
  return function GaddiFamilyMark(props: CollieMarkProps) {
    const m = useMark(spec, props);
    const body = useMemo(() => ({ __html: markup }), []);
    return (
      <svg {...m.root}>
        <style>{STYLE}</style>
        <g className={m.live ? undefined : "cm-drift"} dangerouslySetInnerHTML={body} />
      </svg>
    );
  };
}

export const CollieMark = collieFamilyMark("collie", "");
