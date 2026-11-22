import { describe, expect, test } from "vitest";

import { fixMessage, localLink, localOutcome } from "./local-link";

const probe = (loopback: boolean, tailnet: boolean | null, address: string | null = "100.101.86.18") => ({
  port: 5173,
  loopback,
  tailnet,
  address: tailnet === null ? null : address,
});

describe("localLink", () => {
  test("every loopback spelling with a dev-server port is a local link", () => {
    for (const href of [
      "http://localhost:5173/",
      "http://127.0.0.1:5173/app?x=1#top",
      "http://[::1]:5173/",
      "http://0.0.0.0:5173",
    ]) {
      expect({ href, port: localLink(href)?.port }).toEqual({ href, port: 5173 });
    }
  });

  test("https, a system port, no port, another host and a non-URL are not", () => {
    for (const href of [
      "https://localhost:5173/",
      "http://localhost:80/",
      "http://localhost/",
      "http://lodge:5173/",
      "http://100.101.86.18:5173/",
      "localhost:5173",
      "not a url",
    ]) {
      expect({ href, link: localLink(href) }).toEqual({ href, link: null });
    }
  });
});

describe("localOutcome", () => {
  const link = localLink("http://localhost:5173/app/page?x=1#top")!;

  test("reachable on the tailnet: the tailnet IP, with the path, query and fragment kept", () => {
    expect(localOutcome(link, probe(true, true))).toEqual({ kind: "open", href: "http://100.101.86.18:5173/app/page?x=1#top" });
  });

  test("listening on loopback only is the case the fix button is for", () => {
    expect(localOutcome(link, probe(true, false))).toEqual({ kind: "loopback", port: 5173 });
  });

  test("nothing listening says so, with or without a tailnet address", () => {
    expect(localOutcome(link, probe(false, false))).toEqual({ kind: "closed", port: 5173 });
    expect(localOutcome(link, probe(false, null))).toEqual({ kind: "closed", port: 5173 });
  });

  test("no answer, or no tailnet address to rewrite to, opens the link as printed", () => {
    expect(localOutcome(link, null)).toEqual({ kind: "as-is", href: link.url.href });
    expect(localOutcome(link, probe(true, null))).toEqual({ kind: "as-is", href: link.url.href });
  });
});

test("the fix message names the port and no framework", () => {
  const message = fixMessage(5173);
  expect(message).toContain("port 5173");
  expect(message).toContain("all interfaces");
  expect(message).not.toMatch(/vite|--host|astro|next/i);
});
