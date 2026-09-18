import { cn } from "@/lib/cn";

const TONES = {
  neutral: "bg-gray-100",
  accent: "bg-blue-100",
};

export function Badge({ label, tone = "neutral", className }) {
  return (
    <span className={cn("rounded px-2 py-1", TONES[tone], className)}>{label}</span>
  );
}
