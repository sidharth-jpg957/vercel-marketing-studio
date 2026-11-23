// Lists shared by the browser (public/app.js) and the server (api/ai.js).
// Edit them here once and both sides stay in step.

// ---------------------------------------------------------------- the purchase journey
export const STAGES = [
  {
    id: "trigger", label: "The trigger", intro: "What happens just before they start thinking about buying?",
    questions: [
      { id: "need", q: "What makes them need this? Describe the moment.", ph: "e.g. the old laptop keeps crashing a week before exams" },
      { id: "context", q: "Where are they, and who is with them or influencing them?", ph: "e.g. at home; a parent says 'just buy a new one'" },
      { id: "firstBrands", q: "Which brands come to mind first, before any searching?", ph: "e.g. HP and Dell, because friends use them" },
    ],
  },
  {
    id: "search", label: "Looking around", intro: "Where do they go to learn more?",
    questions: [
      { id: "whereLook", q: "Where do they look first, and then where?", ph: "e.g. YouTube reviews, then Flipkart, then asks a cousin" },
      { id: "seeHear", q: "What do they see, hear or read there?", ph: "e.g. comparison videos, star ratings, festive-sale banners" },
    ],
  },
  {
    id: "compare", label: "Comparing", intro: "How do they narrow it down?",
    questions: [
      { id: "shortlist", q: "Which brands end up on the shortlist?", ph: "e.g. Lenovo, HP, Asus" },
      { id: "compareOn", q: "What do they compare on?", ph: "e.g. price, battery life, looks, reviews, warranty" },
      { id: "dropReason", q: "What makes a brand drop off the list?", ph: "e.g. bad service-centre reviews, looks dated" },
    ],
  },
  {
    id: "buy", label: "Buying", intro: "The moment of purchase.",
    questions: [
      { id: "whereBuy", q: "Where exactly do they buy? Online or offline, which app or store?", ph: "e.g. Croma store after checking the price on Amazon" },
      { id: "finalSay", q: "Who has the final say, and what tips the decision?", ph: "e.g. parent pays; a bank-card discount tips it" },
      { id: "blockers", q: "What could stop the purchase at the last moment?", ph: "e.g. out of stock, EMI not available" },
    ],
  },
  {
    id: "use", label: "Using it", intro: "Life with the product.",
    questions: [
      { id: "howUse", q: "How, where and how often do they use it?", ph: "e.g. daily, in college and at home, mostly for notes and Netflix" },
      { id: "brandMoments", q: "When do they notice the brand while using it?", ph: "e.g. start-up sound, logo on the lid, the charger" },
    ],
  },
  {
    id: "again", label: "Buying again or switching", intro: "What happens next time?",
    questions: [
      { id: "repeat", q: "What makes them buy again, recommend it, or switch?", ph: "e.g. switches if a friend's new brand looks better" },
      { id: "cycle", q: "How long until they buy in this category again?", ph: "e.g. 4 to 5 years" },
    ],
  },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const KEY_STAGES = ["trigger", "search", "compare", "buy"]; // needed before Distinct can check assets

// How the marketer knows what they wrote about a stage.
export const KNOW = {
  customers: "From customers",
  experience: "From my own experience",
  guess: "A guess",
  unknown: "I don't know",
};

// ---------------------------------------------------------------- planning lists
export const CATEGORY_TYPES = [
  "Frequently bought consumer product (e.g. toothpaste, snacks)",
  "Occasional big purchase (e.g. laptop, phone)",
  "Subscription or app",
  "Service (e.g. salon, coaching)",
  "B2B (selling to businesses)",
];
export const GOALS = [
  "Grow the number of buyers (penetration)", "Launch a new product", "Enter a new market",
  "Brand awareness", "Sales / conversions", "Defend against a competitor",
];
export const MARKETS = [
  { group: "Home", items: ["India"] },
  { group: "Netherlands and Europe", items: ["Netherlands", "Germany", "United Kingdom", "France"] },
  { group: "Gulf", items: ["UAE", "Saudi Arabia", "Qatar"] },
  { group: "South and Southeast Asia", items: ["Singapore", "Indonesia", "Vietnam", "Bangladesh", "Sri Lanka"] },
  { group: "North America and others", items: ["USA", "Canada", "Australia", "Africa"] },
];
export const ALL_MARKETS = MARKETS.flatMap((g) => g.items);
export const EXPANSION_MARKETS = ALL_MARKETS.filter((m) => m !== "India");

export const ASSET_TYPES = [
  "Colour", "Logo or symbol", "Tagline or slogan", "Recurring phrase or tone", "Character or mascot",
  "Sound, jingle or music", "Packaging or product shape", "Typography", "Imagery or photo style",
  "Ambassador or celebrity", "Other",
];

export const LIMITS = { competitors: 3, proposedAssets: 6, situations: 10 };

// ---------------------------------------------------------------- Sidharth's playbook
// Sidharth's own notes on "How Brands Grow" by Byron Sharp, grouped into eight principles.
// The numbers in `notes` refer to his original list of 30 insights.
export const PLAYBOOK_LABEL = "Sharp principles, as read by Sidharth";
export const PLAYBOOK_SOURCE =
  "From Sidharth's notes on How Brands Grow by Byron Sharp. These principles guide the plan; they are one reader's notes, not proof that a plan will work.";

export const PLAYBOOK = [
  {
    id: "S1", title: "Easy to buy, in many situations", notes: "1, 30.2",
    text: "Brands that are easier to buy in more situations have more market share. A plan must say where and when someone can buy, and remove friction.",
  },
  {
    id: "S2", title: "Grow by reaching more buyers, not by loyalty", notes: "3, 4, 5, 7, 8",
    text: "Brands of similar share have similar loyalty; they differ mainly in how many people buy them, so focus on penetration. " +
      "Bigger brands also lose fewer customers. Gains from acquisition are far higher than from retention. " +
      "Light buyers tend to get heavier and heavy buyers lighter over time. Roughly 60% of sales come from the top 20% of customers, so the many light buyers still matter.",
  },
  {
    id: "S3", title: "Defection is partly outside your control", notes: "6",
    text: "A lot of customer defection happens for reasons the brand does not control. Do not blame the plan for all churn or over-invest in win-back.",
  },
  {
    id: "S4", title: "Target the whole category, not a niche", notes: "9, 10, 12, 14, 24",
    text: "Customer profiles of brands in the same category are very similar; brands share customers in line with their size; bigger brands win more of the light buyers; " +
      "buyers see rival brands similarly; and people buy across price ranges, so there is no fixed low-price or high-price buyer.",
  },
  {
    id: "S5", title: "Be distinctive, not just different", notes: "2, 15, 30.5",
    text: "Distinctive brand assets (identifying features such as colours, logos, characters, sounds) matter more than differentiation. " +
      "Innovation and differentiation only help a brand last until competitors copy them.",
  },
  {
    id: "S6", title: "Advertising builds memory and reaches light buyers", notes: "16, 17, 18, 20, 21, 22, 23, 30.1, 30.3, 30.4, 30.6",
    text: "Advertising exists to affect buying behaviour. It must get noticed, reach all category buyers continuously, and refresh memory structures " +
      "(what the brand does, how it looks, who uses it) linked to buying situations. Emotional appeal matters. Effects are spread over time and partly stop rivals gaining share. " +
      "Be consistent yet fresh. Supporting idea, not a rule: visible ad spend can itself signal that a brand is here to stay.",
  },
  {
    id: "S7", title: "Separate promotions from advertising", notes: "19, 25, 26",
    text: "Price promotions are time-bound and their effect is easy to see; advertising effects are not, so analyse the two separately. " +
      "Shoppers remember price ranges, deals and price gaps between brands rather than exact prices. Whether price is a salient attribute is the marketer's choice.",
  },
  {
    id: "S8", title: "Price: size and sensitivity", notes: "27, 28",
    text: "A rough average price elasticity across categories is -2.5 (a 10% price cut gives about 25% more volume). This is a book average, not your category's number. " +
      "Bigger brands are less price-sensitive (double jeopardy).",
  },
];
export const PLAYBOOK_BACKDROP = {
  id: "BG", title: "Always-on backdrop", notes: "11, 13, 29, 30.7",
  text: "Consumers behave as if they have not read the brand's marketing plan, they like what they buy, and most choose brands that are good enough (satisfice). " +
    "Stay competitive, keep mass appeal, and do not give buyers reasons not to buy.",
};
export const PRINCIPLE_IDS = [...PLAYBOOK.map((p) => p.id), PLAYBOOK_BACKDROP.id];
