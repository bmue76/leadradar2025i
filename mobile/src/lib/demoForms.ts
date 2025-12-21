type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "CHECKBOX"
  | "DATE"
  | "DATETIME"
  | "URL"
  | "SELECT"
  | "MULTISELECT";

export const DEMO_FORM_ID = "demo-offline-form";

export type DemoFormListItem = {
  id: string;
  name: string;
  fieldCount: number;
};

export type DemoFormField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string | null;
  helpText?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
  config?: { options?: Array<string | { label?: string; value?: string }> } | null;
};

export type DemoFormDetail = {
  id: string;
  name: string;
  fields: DemoFormField[];
};

export function getDemoFormsList(): DemoFormListItem[] {
  return [
    {
      id: DEMO_FORM_ID,
      name: "Offline Demo Form",
      fieldCount: 8,
    },
  ];
}

export function getDemoFormDetail(formId: string): DemoFormDetail | null {
  if (formId !== DEMO_FORM_ID) return null;

  return {
    id: DEMO_FORM_ID,
    name: "Offline Demo Form",
    fields: [
      {
        id: "f1",
        key: "company",
        label: "Company",
        type: "TEXT",
        required: true,
        placeholder: "e.g. ACME AG",
        sortOrder: 10,
        isActive: true,
      },
      {
        id: "f2",
        key: "contact_name",
        label: "Contact name",
        type: "TEXT",
        required: true,
        placeholder: "First + last name",
        sortOrder: 20,
        isActive: true,
      },
      {
        id: "f3",
        key: "email",
        label: "Email",
        type: "EMAIL",
        required: true,
        placeholder: "name@company.com",
        sortOrder: 30,
        isActive: true,
      },
      {
        id: "f4",
        key: "phone",
        label: "Phone",
        type: "PHONE",
        required: false,
        placeholder: "+41 …",
        sortOrder: 40,
        isActive: true,
      },
      {
        id: "f5",
        key: "interest",
        label: "Interest",
        type: "SELECT",
        required: true,
        helpText: "Single select demo",
        sortOrder: 50,
        isActive: true,
        config: {
          options: [
            { label: "Product", value: "product" },
            { label: "Partnership", value: "partnership" },
            { label: "Support", value: "support" },
          ],
        },
      },
      {
        id: "f6",
        key: "topics",
        label: "Topics",
        type: "MULTISELECT",
        required: false,
        helpText: "Multi select demo",
        sortOrder: 60,
        isActive: true,
        config: {
          options: ["Pricing", "Integration", "Demo", "Roadmap"],
        },
      },
      {
        id: "f7",
        key: "follow_up_date",
        label: "Follow up date",
        type: "DATE",
        required: false,
        placeholder: "YYYY-MM-DD",
        sortOrder: 70,
        isActive: true,
      },
      {
        id: "f8",
        key: "notes",
        label: "Notes",
        type: "TEXTAREA",
        required: false,
        placeholder: "Free text…",
        sortOrder: 80,
        isActive: true,
      },
      {
        id: "f9",
        key: "gdpr_ok",
        label: "GDPR consent",
        type: "CHECKBOX",
        required: true,
        helpText: "Required checkbox demo (must be ON)",
        sortOrder: 90,
        isActive: true,
      },
    ],
  };
}
