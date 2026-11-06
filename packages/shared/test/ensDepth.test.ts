import { describe, expect, it } from "vitest";
import { describeEnsAuthority, CAN_TRANSFER_ADMIN } from "../src/ensDepth";
describe("deployed ENS authority reporting",()=>{
 it("does not confuse owner with record setter or fabricate a transfer grant",()=>{
  const r=describeEnsAuthority({status:2,expiry:2000n,now:1000n,ownerRoles:0n,linkRoles:0n,profileRoles:16n,contextRoles:0n});
  expect(r).toMatchObject({registered:true,expired:false,transferPermission:false,recordAliasingAvailable:false,financeCanEditProfile:true,collectionsCanEditContext:false,auditorReadOnly:true});
 });
 it("keeps expiry separate from direct resolver permissions",()=>{
  const r=describeEnsAuthority({status:1,expiry:999n,now:1000n,ownerRoles:CAN_TRANSFER_ADMIN,linkRoles:1n<<28n,profileRoles:0n,contextRoles:16n});
  expect(r.expired).toBe(true);expect(r.registered).toBe(false);expect(r.collectionsCanEditContext).toBe(true);
  expect(r.warning).toContain("does not revoke");
 });
 it("does not claim invoice holder resolution from generic bundle aliasing",()=>{
  const r=describeEnsAuthority({status:2,expiry:2000n,now:1000n,ownerRoles:CAN_TRANSFER_ADMIN,linkRoles:1n<<28n,profileRoles:0n,contextRoles:0n});
  expect(r.transferPermission).toBe(true);expect(r.recordAliasingAvailable).toBe(true);expect(r.invoiceHolderWildcard).toBe(false);
 });
});
