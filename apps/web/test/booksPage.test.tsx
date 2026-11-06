import { expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BooksPage from "../app/dashboard/books/page";
it("starts empty with a month selector, a local verifier and accounting limits",()=>{
 const html=renderToStaticMarkup(<BooksPage />);
 expect(html).toContain('type="month"');
 expect(html).toContain("Choose a month");
 expect(html).toContain("Verify a line offline");
 expect(html).toContain("not tax advice");
 expect(html).not.toContain("Download signed bundle");
});
