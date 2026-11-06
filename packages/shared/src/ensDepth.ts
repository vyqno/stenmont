/** Verified deployed RegistryRolesLib: transfer permission is token-only and not grantable after registration. */
export const CAN_TRANSFER_ADMIN = 1n << 156n;
export type EnsAuthorityFacts = { status:number; expiry:bigint; now:bigint; ownerRoles:bigint; linkRoles:bigint; profileRoles:bigint; contextRoles:bigint };
/** Reports permissions, not a promise that a transfer/write will succeed. No authority is inferred from a role's friendly name. */
export function describeEnsAuthority(f:EnsAuthorityFacts){
 return {
  registered:f.status===2&&f.expiry>f.now, expired:f.expiry>0n&&f.expiry<=f.now,
  transferPermission:(f.ownerRoles&CAN_TRANSFER_ADMIN)!==0n,
  recordAliasingAvailable:(f.linkRoles&(1n<<28n))!==0n,
  financeCanEditProfile:(f.profileRoles&16n)!==0n, collectionsCanEditContext:(f.contextRoles&16n)!==0n,
  auditorReadOnly:true, invoiceHolderWildcard:false,
  warning:"Registry expiry stops normal name resolution; it does not revoke independent direct resolver permissions. Bundle aliasing shares payout records too and is not a policy-only alias.",
 };
}
