import { expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Agent from "../app/dashboard/agent/page";
it("renders a labelled assistant, usage, tool toggles and explicit review boundary",()=>{
 const html=renderToStaticMarkup(<Agent/>);expect(html).toContain("Finance assistant");expect(html).toContain("passkey confirmation");expect(html).toContain("Allowed tools for this conversation");expect(html).toContain('type="password"');expect(html).toContain('for="agent-message"');expect(html).toContain("Gemini (default)");
});
