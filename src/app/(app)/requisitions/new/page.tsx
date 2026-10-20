import { getContext } from "@/lib/context";
import { Topbar } from "@/components/ui";
import { RequisitionForm } from "./form";

export const metadata = { title: "New requisition" };

export default async function NewRequisition() {
  const { supabase, orgId } = await getContext();
  const [departments, projects, donors, budgets] = await Promise.all([
    supabase.from("departments").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("donors").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("budget_lines").select("code, department_id, project_id, donor_id, amount_minor, committed_minor").eq("org_id", orgId),
  ]);
  return (
    <>
      <Topbar crumbs={[{ label: "Requisitions", href: "/requisitions" }, { label: "New requisition" }]} />
      <div className="content">
        <RequisitionForm
          departments={departments.data ?? []}
          projects={projects.data ?? []}
          donors={donors.data ?? []}
          budgets={budgets.data ?? []}
        />
      </div>
    </>
  );
}
