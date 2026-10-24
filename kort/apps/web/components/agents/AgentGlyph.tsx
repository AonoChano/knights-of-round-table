const GLYPHS: Record<string, { icon: string; markup: string }> = {
  archivist: {
    icon: "archivist",
    markup:
      '<g class="part sheet"><path d="M7 10V4a1 1 0 0 1 1-1h7l3 3v4M14 3v4h4M10 7h1"/></g><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M9 14h6m-5 3h4"/>',
  },
  "creative-thinker": {
    icon: "creative-spark",
    markup:
      '<path class="part bulb" d="M8 16c0-2.6-3-3.4-3-7a7 7 0 0 1 11.4-5.4M16 16c0-1.8 1.5-2.8 2.4-4.6M8 17h8m-7 4h6"/><path class="part spark" d="m17 2 1.4 4.6L23 8l-4.6 1.4L17 14l-1.4-4.6L11 8l4.6-1.4L17 2Z"/>',
  },
  "critic-main": {
    icon: "critical-thinker",
    markup:
      '<g class="part lens"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5.5 5.5M8.2 8.3a2 2 0 0 1 3.8.8c0 1.4-2 1.5-2 2.9m0 2h.01"/></g>',
  },
  "synthesizer-main": {
    icon: "discussion-host",
    markup:
      '<g class="part bubble-a"><path d="M10 15H7l-4 3V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3M7 7h7"/></g><g class="part bubble-b"><path d="M13 10h6a2 2 0 0 1 2 2v9l-3-2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2ZM14 14h4"/></g>',
  },
  "dream-weaver": {
    icon: "dream-weaver",
    markup:
      '<path class="part thread-a" d="M4 8c5-8 11 16 16 8M4 16C9 24 15 0 20 8"/><path class="part thread-b" d="M4 12c4-5 12 5 16 0"/><path class="part star" d="M16 2v4m-2-2h4"/>',
  },
  "field-scribe": {
    icon: "field-recorder",
    markup:
      '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4m-4 5h4m-4 5h4"/><path class="part landscape" d="m9 14 3-4 3 4 2-2m-8 5h7"/><path d="M10 6h5"/>',
  },
  gardener: {
    icon: "gardener",
    markup:
      '<path d="M5 21h14m-7 0V11"/><g class="part leaves"><path d="M12 14C6 14 4 10 4 6c5 0 8 3 8 8ZM12 10c0-5 3-7 8-7 0 5-3 8-8 8"/></g>',
  },
  "logician-main": {
    icon: "logic-analyst",
    markup:
      '<path d="M12 8v4M5 16v-4h14v4"/><path class="part node-a" d="m12 2 4 3-4 3-4-3 4-3Z"/><rect class="part node-b" x="2" y="16" width="6" height="5" rx="1"/><circle class="part node-c" cx="19" cy="18.5" r="2.5"/>',
  },
  "research-lead": {
    icon: "research-lead",
    markup:
      '<circle cx="10" cy="13" r="6.5"/><path d="m15 18 5 4"/><path class="part needle" d="m12.5 10.5-1.3 3.7-3.7 1.3 1.3-3.7 3.7-1.3Z"/><path class="part star" d="M18 2v6m-3-3h6"/>',
  },
  "summarizer-main": {
    icon: "visible-summarizer",
    markup:
      '<g class="part eye"><path d="M3 7s3.5-4 9-4 9 4 9 4-3.5 4-9 4-9-4-9-4Z"/><circle cx="12" cy="7" r="1.5"/></g><path class="part summary" d="M5 16h14M5 20h9"/>',
  },
};

export function AgentGlyph({
  agent,
  size = 14,
  playing = false,
  loop = false,
}: {
  agent: string;
  size?: number;
  /** 播放一次内置动作 */
  playing?: boolean;
  /** 循环内置动作 */
  loop?: boolean;
}) {
  const glyph = GLYPHS[agent];
  if (!glyph) return null;
  const classes = ["agent-glyph"];
  if (playing || loop) classes.push("is-playing");
  if (loop) classes.push("is-looping");
  return (
    <svg
      className={classes.join(" ")}
      data-icon={glyph.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: glyph.markup }}
    />
  );
}
