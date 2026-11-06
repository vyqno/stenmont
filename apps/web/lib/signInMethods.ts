/**
 * Which extra sign-in methods this deployment offers. The API has no capability endpoint yet, so this is a
 * build-time flag (NEXT_PUBLIC_EMAIL_SIGNIN / NEXT_PUBLIC_GOOGLE_SIGNIN = "1"), off by default.
 * Every screen that mentions email or Google sign-in reads it from here, so they can never disagree.
 */
export type SignInMethods = { email: boolean; google: boolean };

export function signInMethods(env: { email?: string; google?: string }): SignInMethods {
  return { email: env.email === "1", google: env.google === "1" };
}

// Next only inlines NEXT_PUBLIC_* when they are written out in full like this.
export const SIGN_IN_METHODS = signInMethods({
  email: process.env.NEXT_PUBLIC_EMAIL_SIGNIN,
  google: process.env.NEXT_PUBLIC_GOOGLE_SIGNIN,
});
