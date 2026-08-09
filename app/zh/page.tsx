import { redirect } from "next/navigation";

/* The Chinese interface was retired with the worldwide beta; old links land on
 * the English planner instead of a 404. */
export default function ChineseHome() {
  redirect("/");
}
