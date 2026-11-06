import {expect,it} from "vitest";
import {anchorMonth} from "../../src/books/anchor";
const root=`0x${"12".repeat(32)}` as const;
it("refuses an unconfigured adapter and only returns confirmed matching anchors",async()=>{
 await expect(anchorMonth(root,"2026-10",2,undefined)).rejects.toThrow("not_configured");
 await expect(anchorMonth(root,"2026-10",2,async()=>({txHash:root,confirmed:false,root,lineCount:2}))).rejects.toThrow("unconfirmed");
 await expect(anchorMonth(root,"2026-10",2,async()=>({txHash:root,confirmed:true,root:`0x${"34".repeat(32)}`,lineCount:2}))).rejects.toThrow("mismatch");
 expect(await anchorMonth(root,"2026-10",2,async(r,p)=>({txHash:root,confirmed:r===root&&p==="2026-10",root,lineCount:2}))).toEqual({txHash:root,confirmed:true,root,lineCount:2});
});
