/**
 * Formulários & Quizzes — definição de um formulário.
 * Este módulo não depende do servidor: é usado pelo editor, pela página pública e pelo backend.
 * A definição publicada fica congelada em uma versão (quiz_form_versions) e nunca é alterada.
 */

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "single_choice",
  "multi_choice",
  "dropdown",
  "scale",
  "date",
  "yes_no",
  "consent",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Tipos com alternativas (e, portanto, pontuação por alternativa). */
export const CHOICE_TYPES: QuestionType[] = ["single_choice", "multi_choice", "dropdown", "yes_no"];

/**
 * Para onde a resposta vai no CRM.
 * `custom:<chave>` usa a chave do campo personalizado (ex.: custom:faturamento), criado se não existir.
 */
export type CrmField = "none" | "name" | "email" | "phone" | "instagram" | "company" | `custom:${string}`;

export type QuizOption = { id: string; label: string; points: number };

export type ConditionOp = "equals" | "not_equals" | "includes" | "not_includes" | "answered" | "gte" | "lte";
export type Condition = { questionId: string; op: ConditionOp; value?: string | number | null };
export type ShowIf = { mode: "all" | "any"; conditions: Condition[] };

export type QuizQuestion = {
  /** Identificador estável: não muda entre versões (usado para comparar respostas e recalcular o score). */
  id: string;
  type: QuestionType;
  title: string;
  description?: string | null;
  placeholder?: string | null;
  required: boolean;
  imageAssetId?: string | null;
  options?: QuizOption[];
  scale?: { min: number; max: number; minLabel?: string | null; maxLabel?: string | null; pointsPerStep: number };
  /** Entra no Lead Score. */
  scored: boolean;
  /** Teto de pontos (múltipla seleção). */
  maxPoints?: number | null;
  crmField: CrmField;
  showIf?: ShowIf | null;
};

export type QuizSection = { id: string; title: string; description?: string | null; questions: QuizQuestion[] };

/** Destino do lead no CRM. */
export type Route = {
  /** relationship = Kanban do Social Seller · sales = Kanban do closer · none = só a base de contatos. */
  mode: "relationship" | "sales" | "none";
  stageId: string | null;
  salesStageId: string | null;
  /** round_robin = rodízio · fixed = responsável fixo · none = sem responsável. */
  assignMode: "round_robin" | "fixed" | "none";
  fixedAssigneeId: string | null;
  /** Pessoas do rodízio (vazio = todos os social sellers ou closers ativos, conforme o funil). */
  assigneeIds: string[];
  /** Avisar o responsável (e os administradores quando ninguém recebe). */
  notify: boolean;
};

/** Requisito para manter a classificação: a resposta precisa estar entre as alternativas aceitas. */
export type Requirement = { id: string; label: string; questionId: string; optionIds: string[] };

export type Tier = {
  id: string;
  label: string;
  description?: string | null;
  /** Pontuação mínima (na escala usada: 0–100 quando normalizado). */
  min: number;
  color: string;
  /** Conta como "lead qualificado" nos painéis. */
  qualified: boolean;
  requirements: Requirement[];
  /** Para onde vai quando algum requisito falha (null = próxima faixa abaixo). */
  demoteTo: string | null;
  tags: string[];
  route: Route;
};

export type Scoring = { enabled: boolean; normalize: boolean; tiers: Tier[] };

export type Appearance = {
  preset: "clean" | "dark" | "custom";
  primary: string;
  secondary: string;
  background: string;
  text: string;
  font: "poppins" | "system" | "serif" | "rounded";
  radius: number;
  buttonStyle: "solid" | "outline" | "pill";
  progressBar: boolean;
  animations: boolean;
  logoAssetId: string | null;
  coverAssetId: string | null;
  layout: "one_per_screen" | "by_section";
  review: boolean;
  finalStyle: "simple" | "celebration";
};

export type ConsentSettings = {
  /** Aviso de tratamento de dados necessário para atender a solicitação (obrigatório, não é consentimento de marketing). */
  noticeText: string;
  marketingEnabled: boolean;
  marketingText: string;
  policyUrl: string | null;
  /** Versão do texto: gravada com cada aceite. */
  version: string;
};

export type FormSettings = {
  title: string;
  description: string | null;
  welcome: string | null;
  completion: string;
  redirectUrl: string | null;
  notifyUserIds: string[];
  sourceId: string | null;
  productId: string | null;
  campaign: string | null;
  tags: string[];
  /** Destino quando o Lead Score está desligado. */
  defaultRoute: Route;
  consent: ConsentSettings;
};

export type QuizDefinition = {
  schemaVersion: 1;
  sections: QuizSection[];
  appearance: Appearance;
  settings: FormSettings;
  scoring: Scoring;
};

/** Valor de uma resposta: texto, id(s) de alternativa, número ou booleano (consentimento). */
export type AnswerValue = string | string[] | number | boolean | null;
export type Answers = Record<string, AnswerValue>;

/** O que a página pública recebe: sem pontos, sem regras, sem destinos. */
export type PublicQuestion = Omit<QuizQuestion, "scored" | "maxPoints" | "crmField" | "options" | "scale"> & {
  options?: { id: string; label: string }[];
  scale?: { min: number; max: number; minLabel?: string | null; maxLabel?: string | null };
  identity?: "name" | "email" | "phone" | "instagram" | "company";
};
export type PublicDefinition = {
  sections: (Omit<QuizSection, "questions"> & { questions: PublicQuestion[] })[];
  appearance: Appearance;
  settings: Pick<FormSettings, "title" | "description" | "welcome" | "completion" | "redirectUrl"> & { consent: ConsentSettings };
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "Texto curto",
  long_text: "Texto longo",
  email: "E-mail",
  phone: "Telefone/WhatsApp",
  url: "Instagram/URL",
  single_choice: "Múltipla escolha",
  multi_choice: "Várias alternativas",
  dropdown: "Lista suspensa",
  scale: "Escala numérica",
  date: "Data",
  yes_no: "Sim ou não",
  consent: "Consentimento",
};

export const FORM_STATUS_LABEL = { draft: "Rascunho", published: "Publicado", archived: "Arquivado" } as const;
export type FormStatus = keyof typeof FORM_STATUS_LABEL;

export const PRIVACY_KIND_LABEL = { access: "Acesso aos dados", correction: "Correção", deletion: "Exclusão/anonimização", revoke_marketing: "Revogar consentimento de marketing", other: "Outro" } as const;
