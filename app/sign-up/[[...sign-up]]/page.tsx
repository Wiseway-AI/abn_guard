import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="clerk-auth-page">
      <SignUp forceRedirectUrl="/app/check" />
    </div>
  );
}
