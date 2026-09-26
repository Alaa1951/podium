// ─────────────────────────────────────────────────────────────────────────────
// THE PERMISSION CATALOG — the whole vocabulary of access, in one tree.
//
// Module → Screen → action. Every key is `screen.action`, and `PermissionKey`
// is derived from this table, so a guard naming a key that does not exist is a
// compile error rather than a silent "nobody may".
//
// Each permission carries a POLICY that decides who can ever hold it, whatever
// a role says:
//
//   general        always on for every signed-in account, even one still
//                  waiting for approval. Never stored in a role.
//   role           granted through roles and per-person grants. The normal case.
//   bftOnly        may sit in a role, but only BFT MENA accounts (Full or
//                  Partial) can ever hold it — it is above the ceiling of every
//                  studio, organiser and athlete account.
//   fullAdminOnly  never grantable. BFT MENA Full access has it because it has
//                  everything; nobody else can be given it by anyone.
//
// Pure data, no imports that touch the database — the roles screen, the
// resolver, the guards and the tests all read the same table.
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionPolicy = "general" | "role" | "bftOnly" | "fullAdminOnly";

type ActionDef = {
  label: string;
  labelAr: string;
  policy: PermissionPolicy;
};

type ScreenDef = {
  label: string;
  labelAr: string;
  actions: Record<string, ActionDef>;
};

type ModuleDef = {
  label: string;
  labelAr: string;
  screens: Record<string, ScreenDef>;
};

const view = (policy: PermissionPolicy = "role"): ActionDef => ({
  label: "View",
  labelAr: "عرض",
  policy,
});

const act = (label: string, labelAr: string, policy: PermissionPolicy = "role"): ActionDef => ({
  label,
  labelAr,
  policy,
});

export const CATALOG = {
  platform: {
    label: "Platform",
    labelAr: "المنصة",
    screens: {
      dashboard: {
        label: "Dashboard",
        labelAr: "لوحة التحكم",
        actions: { view: view("bftOnly") },
      },
      competitions: {
        label: "Competitions",
        labelAr: "المسابقات",
        actions: {
          view: view("bftOnly"),
          create: act("Create competitions", "إنشاء المسابقات", "bftOnly"),
        },
      },
      studios: {
        label: "Studios",
        labelAr: "الاستوديوهات",
        actions: {
          view: view("bftOnly"),
          create: act("Add studios", "إضافة الاستوديوهات", "bftOnly"),
          edit: act("Edit and deactivate studios", "تعديل وإيقاف الاستوديوهات", "bftOnly"),
        },
      },
      users: {
        label: "Users",
        labelAr: "المستخدمون",
        actions: {
          view: view(),
          invite: act("Invite people", "دعوة الأشخاص"),
          edit: act("Edit name, email and account type", "تعديل الاسم والبريد ونوع الحساب", "bftOnly"),
          disable: act("Block and unblock", "إيقاف وتفعيل"),
          delete: act("Remove and restore", "إزالة واستعادة"),
          assignRoles: act("Give and take away roles", "منح الأدوار وسحبها"),
          overrides: act("Grant or lock single permissions", "منح أو قفل صلاحيات فردية", "bftOnly"),
        },
      },
      approvals: {
        label: "Sign-up requests",
        labelAr: "طلبات التسجيل",
        actions: {
          view: view(),
          decide: act("Approve and reject", "القبول والرفض"),
        },
      },
      roles: {
        label: "Roles",
        labelAr: "الأدوار",
        actions: {
          view: view("bftOnly"),
          edit: act("Create and edit roles", "إنشاء الأدوار وتعديلها", "bftOnly"),
        },
      },
      audit: {
        label: "Audit log",
        labelAr: "سجل التغييرات",
        actions: { view: view("bftOnly") },
      },
      announcements: {
        label: "Announcements",
        labelAr: "الإعلانات",
        actions: {
          view: view("general"),
          send: act("Send announcements", "إرسال الإعلانات"),
        },
      },
    },
  },
  competition: {
    label: "Competition",
    labelAr: "البطولة",
    screens: {
      overview: {
        label: "Overview",
        labelAr: "نظرة عامة",
        actions: { view: view() },
      },
      competitionStudios: {
        label: "Taking part",
        labelAr: "المشاركون",
        actions: {
          view: view(),
          edit: act("Choose the studios taking part", "اختيار الاستوديوهات المشاركة", "bftOnly"),
        },
      },
      registrations: {
        label: "Registrations",
        labelAr: "التسجيلات",
        actions: {
          view: view(),
          create: act("Register teams", "تسجيل الفرق"),
          edit: act("Edit teams and athletes", "تعديل الفرق والرياضيين"),
          archive: act("Withdraw and restore teams", "سحب الفرق واستعادتها"),
          pair: act("Pair two athletes into a team", "جمع رياضيين في فريق"),
          // Not `view`: these are people who have NOT registered, so "the
          // entry list" would be the wrong promise. Split out so a pairing
          // coordinator can be given these four lists without the roster and
          // the money column that come with `registrations.view`.
          partners: act(
            "See athletes without a partner or a team",
            "عرض الرياضيين بلا شريك أو فريق"
          ),
          // Letting somebody off the waiting list hands out a PLACE, which is
          // the scarce thing here — the wave plan and the station count are
          // built on it. `bftOnly`, like payment, because deciding how many
          // people the floor can hold is not a studio's call.
          waitlist: act("Admit entries from the waiting list", "قبول التسجيلات من قائمة الانتظار", "bftOnly"),
          payment: act("Confirm payment and attendance", "تأكيد الدفع والحضور", "bftOnly"),
          // Checking a team in at the door is floor work, not money: split from
          // `payment` (BFT MENA only) so the Organiser can run check-in on the
          // day. `payment` still covers it for whoever holds that.
          attendance: act("Check teams in on the day", "تسجيل حضور الفرق يوم البطولة"),
          export: act("Export the roster", "تصدير القائمة"),
        },
      },
      waves: {
        label: "Wave schedule",
        labelAr: "جدول الموجات",
        actions: {
          view: view(),
          placeTeams: act("Place teams into waves and stations", "توزيع الفرق على الموجات والمحطات"),
          edit: act("Create waves and set times", "إنشاء الموجات وتحديد المواعيد"),
        },
      },
      waveControl: {
        label: "Wave control",
        labelAr: "التحكم في الموجات",
        actions: {
          view: view(),
          control: act("Start and end waves (supervisor)", "بدء الموجات وإنهاؤها (المشرف)"),
        },
      },
      zoneStaff: {
        label: "Zone teams",
        labelAr: "فرق المناطق",
        actions: {
          view: view(),
          assign: act("Put judges on zones and pick zone leaders", "توزيع الحكام وتحديد قادة المناطق"),
        },
      },
      scores: {
        label: "Scores",
        labelAr: "الدرجات",
        actions: {
          view: view(),
          enter: act("Enter scores", "إدخال الدرجات"),
          correct: act("Correct a submitted score", "تصحيح درجة مُرسلة", "fullAdminOnly"),
          unlock: act("Unlock a submitted score", "فتح درجة مُرسلة", "fullAdminOnly"),
        },
      },
      results: {
        label: "Results",
        labelAr: "النتائج",
        actions: {
          view: view(),
          publish: act("Publish results to the public site", "نشر النتائج على الموقع العام", "bftOnly"),
        },
      },
      board: {
        label: "Live board",
        labelAr: "اللوحة المباشرة",
        actions: { view: view("general") },
      },
      settings: {
        label: "Competition settings",
        labelAr: "إعدادات البطولة",
        actions: {
          view: view(),
          edit: act("Edit settings, zones and scoring", "تعديل الإعدادات والمناطق والتسجيل", "bftOnly"),
        },
      },
      sponsors: {
        label: "Sponsors",
        labelAr: "الرعاة",
        actions: { edit: act("Manage sponsor logos", "إدارة شعارات الرعاة", "bftOnly") },
      },
    },
  },
  personal: {
    label: "Personal",
    labelAr: "الحساب الشخصي",
    screens: {
      home: {
        label: "Home and profile",
        labelAr: "الرئيسية والملف الشخصي",
        actions: { view: view("general") },
      },
      notifications: {
        label: "Notifications",
        labelAr: "الإشعارات",
        actions: { view: view("general") },
      },
      athleteHome: {
        label: "My team",
        labelAr: "فريقي",
        actions: {
          view: view(),
          editTeam: act("Edit my team", "تعديل فريقي"),
        },
      },
      partner: {
        label: "Partner",
        labelAr: "الشريك",
        actions: {
          view: view(),
          edit: act("Change partner details", "تعديل بيانات الشريك"),
          // Split from `edit` on purpose: `browse` is the one read in the whole
          // system that steps outside an athlete's own account scope, and
          // `request` is the write that follows it. Answering a request you
          // have already received stays on `edit`, so withdrawing `request`
          // never leaves somebody with an inbox they cannot reply to.
          browse: act("Find a partner", "البحث عن شريك"),
          request: act("Send partner requests", "إرسال طلبات الشراكة"),
        },
      },
      judgeSheet: {
        label: "Judge sheet",
        labelAr: "ورقة الحكم",
        actions: { view: view() },
      },
    },
  },
} as const satisfies Record<string, ModuleDef>;

type Catalog = typeof CATALOG;
type ModuleKey = keyof Catalog;
type ScreensOf<M extends ModuleKey> = Catalog[M]["screens"];
type ActionsOf<T> = T extends { actions: infer A } ? keyof A & string : never;

/** Every valid permission key, as a type: `"scores.enter"`, `"users.view"`… */
export type PermissionKey = {
  [M in ModuleKey]: {
    [S in keyof ScreensOf<M> & string]: `${S}.${ActionsOf<ScreensOf<M>[S]>}`;
  }[keyof ScreensOf<M> & string];
}[ModuleKey];

export type PermissionEntry = {
  key: PermissionKey;
  module: string;
  screen: string;
  action: string;
  label: string;
  labelAr: string;
  screenLabel: string;
  screenLabelAr: string;
  policy: PermissionPolicy;
};

/** The catalog flattened into rows, in display order. */
export const PERMISSIONS: PermissionEntry[] = Object.entries(CATALOG).flatMap(
  ([moduleKey, module]) =>
    Object.entries(module.screens as Record<string, ScreenDef>).flatMap(([screenKey, screen]) =>
      Object.entries(screen.actions).map(([actionKey, action]) => ({
        key: `${screenKey}.${actionKey}` as PermissionKey,
        module: moduleKey,
        screen: screenKey,
        action: actionKey,
        label: action.label,
        labelAr: action.labelAr,
        screenLabel: screen.label,
        screenLabelAr: screen.labelAr,
        policy: action.policy,
      }))
    )
);

const BY_KEY = new Map<string, PermissionEntry>(PERMISSIONS.map((entry) => [entry.key, entry]));

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((entry) => entry.key);

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key);
}

export function permissionEntry(key: string): PermissionEntry | undefined {
  return BY_KEY.get(key);
}

export function policyOf(key: string): PermissionPolicy | undefined {
  return BY_KEY.get(key)?.policy;
}

/** Always on for every signed-in account, approved or not. */
export const GENERAL_PERMISSIONS: PermissionKey[] = PERMISSIONS.filter(
  (entry) => entry.policy === "general"
).map((entry) => entry.key);

/**
 * Keys a role may store: everything except `general` (already on for all) and
 * `fullAdminOnly` (never grantable).
 */
export const STORABLE_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.filter(
  (entry) => entry.policy === "role" || entry.policy === "bftOnly"
).map((entry) => entry.key);

/**
 * The permission keys of the previous catalog, and what each one means now.
 * Stored role rows written before the new catalog are read through this, so
 * nobody silently loses — or gains — access on upgrade. The roles screen only
 * ever saves new keys.
 */
export const LEGACY_KEY_MAP: Record<string, PermissionKey[]> = {
  "users.manage": ["users.invite", "users.edit", "users.disable", "users.delete", "users.assignRoles"],
  "studios.manage": ["studios.create", "studios.edit"],
  "announcements.manage": ["announcements.send"],
  "roles.manage": ["roles.view", "roles.edit"],
  "competitors.view": ["registrations.view"],
  "competitors.manage": ["registrations.create", "registrations.edit", "registrations.archive"],
  "scores.edit": ["scores.enter"],
  // Correcting after the clock closed is now BFT MENA Full access only.
  "scores.afterClose": [],
  "waves.manage": ["waves.edit", "waves.placeTeams", "waveControl.view", "waveControl.control"],
  "settings.manage": ["settings.edit"],
  "sponsors.manage": ["sponsors.edit"],
  "publish.manage": ["results.publish"],
};

/**
 * Read a stored permission list: translate legacy keys, drop anything the
 * catalog does not know, drop what a role may never carry, de-duplicate.
 * Whatever is in the database, what comes out is a clean list of storable keys.
 */
export function normalizeStoredPermissions(stored: unknown): PermissionKey[] {
  if (!Array.isArray(stored)) return [];
  const out = new Set<PermissionKey>();
  for (const raw of stored) {
    if (typeof raw !== "string") continue;
    const mapped = LEGACY_KEY_MAP[raw] ?? (isPermissionKey(raw) ? [raw] : []);
    for (const key of mapped) {
      const policy = policyOf(key);
      if (policy === "role" || policy === "bftOnly") out.add(key);
    }
  }
  return [...out];
}

/** The modules → screens → actions tree, for the permission editors. */
export type PermissionTreeModule = {
  key: string;
  label: string;
  labelAr: string;
  screens: {
    key: string;
    label: string;
    labelAr: string;
    permissions: PermissionEntry[];
  }[];
};

export const PERMISSION_TREE: PermissionTreeModule[] = Object.entries(CATALOG).map(
  ([moduleKey, module]) => ({
    key: moduleKey,
    label: module.label,
    labelAr: module.labelAr,
    screens: Object.entries(module.screens as Record<string, ScreenDef>).map(
      ([screenKey, screen]) => ({
        key: screenKey,
        label: screen.label,
        labelAr: screen.labelAr,
        permissions: PERMISSIONS.filter(
          (entry) => entry.module === moduleKey && entry.screen === screenKey
        ),
      })
    ),
  })
);
