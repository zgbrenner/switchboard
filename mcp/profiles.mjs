export const PROFILE_NAMES = ['general', 'coding', 'legal', 'research', 'creative', 'security', 'finance', 'medical', 'low-cost', 'low-latency'];

const PROFILES = Object.freeze({
  general: { title: 'General', policy: 'balanced', minimumTier: 'fast', requiredCapabilities: {}, categoryBoosts: {} },
  coding: { title: 'Coding', policy: 'balanced', minimumTier: 'balanced', requiredCapabilities: { code: true }, categoryBoosts: { code: 0.12, architecture: 0.08, security: 0.04 } },
  legal: { title: 'Legal', policy: 'best', minimumTier: 'deep', requiredCapabilities: {}, categoryBoosts: { legal: 0.2, 'high-stakes': 0.12, research: 0.06 } },
  research: { title: 'Research', policy: 'best', minimumTier: 'balanced', requiredCapabilities: { web: true }, categoryBoosts: { research: 0.18, sources: 0.1 } },
  creative: { title: 'Creative', policy: 'balanced', minimumTier: 'balanced', requiredCapabilities: {}, categoryBoosts: { creative: 0.16, writing: 0.08 } },
  security: { title: 'Security', policy: 'best', minimumTier: 'deep', requiredCapabilities: { code: true }, categoryBoosts: { security: 0.22, code: 0.08, 'high-stakes': 0.12 } },
  finance: { title: 'Finance', policy: 'best', minimumTier: 'deep', requiredCapabilities: {}, categoryBoosts: { finance: 0.2, 'high-stakes': 0.12, analysis: 0.06 } },
  medical: { title: 'Medical', policy: 'best', minimumTier: 'deep', requiredCapabilities: {}, categoryBoosts: { medical: 0.2, 'high-stakes': 0.14, research: 0.06 } },
  'low-cost': { title: 'Low cost', policy: 'conserve', minimumTier: 'fast', requiredCapabilities: {}, categoryBoosts: {} },
  'low-latency': { title: 'Low latency', policy: 'fast', minimumTier: 'fast', requiredCapabilities: {}, categoryBoosts: {} },
});

export function getProfile(name = 'general') {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`profile must be one of ${PROFILE_NAMES.join(', ')}.`);
  return { name, ...profile, requiredCapabilities: { ...profile.requiredCapabilities }, categoryBoosts: { ...profile.categoryBoosts } };
}

export function listProfiles() {
  return PROFILE_NAMES.map((name) => getProfile(name));
}

export function applyProfile(request, profileName) {
  const profile = getProfile(profileName);
  const current = request.preferences ?? {};
  const categoryBoosts = { ...profile.categoryBoosts, ...(current.categoryBoosts ?? {}) };
  return {
    request: {
      ...request,
      preferences: {
        ...current,
        policy: current.policyExplicit ? current.policy : profile.policy,
        categoryBoosts,
      },
    },
    profile,
  };
}
