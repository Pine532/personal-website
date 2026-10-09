import { NASA_RECORD, SOURCE_NOTE, SUN_SOURCE } from './media.ts';

// Everything a visitor reads lives here, so copy can change without touching layout.
// Facts come from Owen's résumé, LinkedIn profile, and GitHub (JavaScript and Linux are listed
// only on LinkedIn). Optional links are null until a real destination exists; the components
// render nothing for a null link.

export type Figure = {
  value: string;
  label: string;
  detail?: string;
  /** The moment of the project's visual that this figure answers, by its name among the scene's `beats`
      (components/visuals/types.ts). While scrolling tells the visual's story, the figure waits for it. */
  beat?: string;
};
type Fact = { label: string; text: string };
type ExternalLink = { label: string; href: string };

export type CaseStudy = {
  id: string;
  title: string;
  organization: string;
  role: string;
  dates: string;
  location?: string;
  summary: string;
  /** Headline results shown large, without opening the case notes. A target or a projection must say so in its label. Leave empty when a project has no results yet. */
  figures: Figure[];
  facts: Fact[];
  tools: string[];
  details: { heading: string; paragraphs: string[] }[];
  comparison?: { caption: string; columns: [string, string, string]; rows: [string, string, string][] };
  links: ExternalLink[];
  /** The moving visual between the case's figures (or heading) and its body (components/visuals/). The
      words drawn inside the art live at the top of its scene module; what screen readers hear and the caption live here. */
  visual?: {
    /** Short name that tells this panel's pause button apart from the others. */
    name: string;
    /** The text alternative: under 60 words, it says "Illustration" and tells the story. */
    label: string;
    /** Starts "Illustration:" and says what is schematic, and which numbers are measured. */
    caption: string;
  };
};

type Credential = { name: string; issuer: string; date: string; href?: string };

// What the page says about its Sun, for each of the two versions (src/media.ts explains them).
// `credit` is the main credit link beside the scene and `more` the link under it. The simulated Sun has
// no `credit`, only the "Modeled on NASA" line. Its `more` link says aloud that the Sun is a
// simulation, and the note (media.ts) stays published.
const SUN_COPY = {
  simulated: {
    credit: null,
    more: { label: 'Modeled on NASA SDO · AIA 304 Å', spoken: 'this Sun is a simulation; NASA’s record of the observation it is modeled on', href: NASA_RECORD },
    loading: 'Loading the simulation…',
    shareImage: 'a simulated image of the whole Sun, in the false color of NASA’s Solar Dynamics Observatory',
    fallback: 'The full site, with its simulated Sun, needs JavaScript.',
  },
  observed: {
    credit: { title: 'NASA Goddard / SDO · AIA 304 Å', detail: 'False-color EUV time-lapse', spoken: 'solar observation footage at 304 angstroms, not live', href: NASA_RECORD },
    more: { label: 'Edited loop · source & usage', spoken: '', href: SOURCE_NOTE },
    loading: 'Loading solar observations…',
    shareImage: 'an extreme-ultraviolet image of the whole Sun from NASA’s Solar Dynamics Observatory',
    fallback: 'The full site, with its solar observation footage, needs JavaScript.',
  },
};
export const sun = SUN_COPY[SUN_SOURCE];

export const profile = {
  name: 'Owen Sun Zhang',
  field: 'Computer engineering',
  location: 'Boston, MA',
  email: 'owenz@bu.edu',
  linkedin: 'https://www.linkedin.com/in/owen-sun-zhang/',
  github: 'https://github.com/Pine532' as string | null,
  // The public copy of the résumé: the same document without the phone number.
  resumeUrl: '/owen-sun-zhang-resume.pdf' as string | null,
  // The no-break spaces keep "Boston University", "class of 2027" and "machine learning" whole when the line wraps.
  introduction: 'Computer engineering student at Boston\u00A0University, class\u00A0of\u00A02027, building across machine\u00A0learning, cloud infrastructure, and hardware.',
  biography: [
    'I’m Owen Sun Zhang, a computer engineering student at Boston University, graduating in May 2027. My work so far spans machine-learning systems, cloud infrastructure, race-car electronics, and rocket propulsion.',
    'At FreeWheel, a Comcast company, I built the backtesting and calibration workflow for production conversion models, then took a calibrated model into live canary auctions. The summer before, at Comcast, I migrated an ad-serving platform from EC2 to Kubernetes. Now I’m developing an autonomous LLM agent that repairs failing software builds, as part of a Microsoft industry project.',
    'On campus I’ve worked on PCB design at Terrier Motorsport and contributed to thruster design with the BU Rocket Propulsion Group. Before BU I co-led my high school’s programming club, taught other students the basics of Python and Java, and advanced to the state competition two years in a row with Rampage 9911, a FIRST Tech Challenge robotics team.',
  ],
  education: {
    university: 'Boston University',
    school: 'College of Engineering',
    degree: 'B.S. in Computer Engineering',
    graduation: 'May 2027',
    gpa: '3.84',
    courses: ['Algorithms', 'Learning From Data', 'Discrete Stochastic Processes', 'Computer Organization'],
    activities: ['Terrier Motorsport', 'Rocket Propulsion Group', 'Chi Phi', 'Study abroad in London'],
    // From the public repository: a team project for the Learning From Data course, spring 2026.
    courseProject: {
      name: 'Cancer drug-sensitivity models',
      summary: 'Team project for Learning From Data: regression baselines, gradient boosting, and a neural network compared on GDSC and secondary-screen drug-response data, with explicit leakage controls.',
      href: 'https://github.com/Pine532/EC503-CancerML-Project',
    },
  },
  // Newest first. Dates are the issuers' own records.
  credentials: [
    {
      name: 'AI & Data Science Program',
      issuer: 'MIT Institute for Data, Systems, and Society (IDSS)',
      date: 'August 2026',
      href: 'https://www.mygreatlearning.com/certificate/BUVDIPBZ',
    },
    {
      name: 'AWS Certified Solutions Architect – Associate',
      issuer: 'Amazon Web Services',
      date: 'December 2023 – December 2026',
      href: 'https://www.credly.com/badges/e5b3d25d-4d7f-4353-b1cb-b18bb7eb7b77',
    },
    {
      name: 'Google Cybersecurity Professional Certificate',
      issuer: 'Google · Coursera',
      date: 'October 2023',
      href: 'https://www.coursera.org/account/accomplishments/professional-cert/4MDENJTJHE3G',
    },
    { name: 'Missouri Seal of Biliteracy, Mandarin', issuer: 'Missouri Department of Elementary and Secondary Education', date: 'April 2023' },
  ] as Credential[],
  skills: [
    { area: 'Languages', items: ['Python', 'C++', 'SQL', 'Java', 'JavaScript', 'MATLAB'] },
    { area: 'ML & data', items: ['TensorFlow', 'TensorFlow Serving', 'scikit-learn', 'LightGBM', 'pandas', 'NumPy', 'Snowflake'] },
    { area: 'Systems & cloud', items: ['Linux', 'Docker', 'Kubernetes', 'AWS (SageMaker, S3, EKS)', 'Terraform'] },
    { area: 'Developer tools', items: ['Git', 'Helm', 'ArgoCD', 'KEDA', 'Prometheus', 'Grafana'] },
  ],
  spokenLanguages: ['English', 'Mandarin'],
  earlier: {
    organization: 'St. Louis Modern Chinese School',
    role: 'Website Programmer, Team Lead',
    dates: 'January 2023 – August 2023',
    location: 'St. Louis, MO',
    summary: 'Led a 20-person team through the design and development of the school’s course-registration website, a site serving 1,000+ monthly visitors, and built its back-end registration workflows.',
  },
};

/** The toolkit as shown: the technical groups, then the languages he speaks. */
export const toolkit = [...profile.skills, { area: 'Spoken languages', items: profile.spokenLanguages }];

/** "https://www.linkedin.com/in/name/" reads as "linkedin.com/in/name". */
export const bareAddress = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// The line beside "Selected work". It counts the entries in projects below: update it when a
// case is added or removed.
export const workIntroduction = 'Two internships, an industry project, and two engineering teams. From model calibration to circuit boards.';

export const projects: CaseStudy[] = [
  {
    id: 'freewheel',
    title: 'From backtesting to live predictions',
    organization: 'FreeWheel · Revenue Science',
    role: 'Machine Learning Engineering Intern',
    dates: 'June 2026 – August 2026',
    location: 'Remote',
    summary: 'Built a temporal backtesting framework to evaluate production cost-per-acquisition (CPA) models, then calibrated a simpler model that outperformed the production neural network offline, and validated it in live canary auctions.',
    figures: [
      { value: '97%', label: 'lower mean conversion-ratio error', detail: '6.07 to 0.18 with per-event calibration', beat: 'calibrated' },
      { value: '2.88×', label: 'top-20% lift', detail: 'vs. 2.72× for the production neural network, offline', beat: 'scored' },
      { value: '0.745', label: 'ROC-AUC', detail: 'vs. 0.733, offline across 9 conversion events', beat: 'scored' },
      { value: '~$300K', label: 'projected monthly savings', detail: 'an estimated 5% reduction in cost per acquisition at constant conversion volume', beat: 'live' },
    ],
    facts: [
      { label: 'Problem', text: 'Production CPA models needed an evaluation that respects time: train on the past, calibrate on held-out data, and score on a future-serving window.' },
      { label: 'Contribution', text: 'Built a Python/SQL backtesting framework on Snowflake and AWS SageMaker, benchmarked a tuned logistic regression against the production neural network, and designed per-event calibration that corrected prediction bias under negative sampling.' },
      { label: 'Result', text: 'Calibration cut mean conversion-ratio error by 97%. Productionized the calibrated model as a TensorFlow SavedModel and confirmed its real-time predictions in live canary auctions, a limited deployment rather than a full rollout.' },
    ],
    tools: ['Python', 'SQL', 'Snowflake', 'AWS SageMaker', 'TensorFlow'],
    comparison: {
      caption: 'Offline evaluation across 9 conversion events',
      columns: ['Metric', 'Tuned logistic regression', 'Production neural network'],
      rows: [['Top-20% lift', '2.88×', '2.72×'], ['ROC-AUC', '0.745', '0.733']],
    },
    details: [
      { heading: 'Evaluation & calibration', paragraphs: [
        'The backtesting framework ran on Snowflake and SageMaker Processing, with sampling-weighted metrics and separate training, calibration, and future-serving windows.',
        'Per-event scalar calibration on held-out data brought mean absolute conversion-ratio error (the absolute value of predicted ÷ observed − 1) from 6.07 down to 0.18.',
      ] },
      { heading: 'Serving & verification', paragraphs: [
        'Implemented sparse feature hashing, numeric normalization, and negative-sampling correction, then exported the calibrated logistic regression as a TensorFlow SavedModel with 23 named serving inputs.',
        'Resolved a TensorFlow 2.17 compatibility issue, verified exact prediction parity on deterministic inputs, and confirmed real-time predictions on won impressions in live canary auctions.',
      ] },
      { heading: 'Further analysis', paragraphs: [
        'Evaluated 128-dimensional postal-code embeddings with matched cohorts and coverage audits, to separate real feature effects from missing-data bias.',
      ] },
    ],
    links: [],
    visual: {
      name: 'FreeWheel',
      label: 'Illustration: a timeline splits into training, calibration and scoring windows. In a lens, nine points, one per conversion event, are pulled onto a ring of perfect calibration; the mean conversion-ratio error reads 6.07, then 0.18. In live canary auctions, a limited share goes to the calibrated model, a TensorFlow SavedModel with 23 serving inputs, the rest to the production model.',
      caption: 'Illustration: a point per conversion event; positions, window lengths and the canary share are schematic; 6.07 and 0.18 are the measured means.',
    },
  },
  {
    id: 'build-repair-agent',
    title: 'An agent that repairs broken builds',
    organization: 'Microsoft Industry Project',
    role: 'Autonomous LLM build-repair agent · in progress',
    dates: 'September 2026 – Present',
    location: 'Boston, MA',
    summary: 'Developing an autonomous LLM agent that diagnoses and fixes compiler, linker, dependency, configuration, and packaging failures across x86_64, ARM/aarch64, and RISC-V.',
    figures: [],
    facts: [
      { label: 'Approach', text: 'An iterative agent tool loop: repository inspection, hypothesis generation, patching, compilation, and artifact validation, all inside isolated Docker environments.' },
      { label: 'Status', text: 'In progress. Designing reproducible evaluation infrastructure for the ICSE 2027 Build-Bench Challenge (International Conference on Software Engineering), measuring verified repair success, runtime, and LLM token cost.' },
    ],
    tools: ['LLM agents', 'Docker'],
    details: [],
    links: [],
    visual: {
      name: 'build-repair agent',
      label: 'Illustration: three builds, on x86_64, ARM/aarch64 and RISC-V, run in isolated Docker environments past dependency, configuration, compiler, linker and packaging stages. When one breaks, the agent’s loop of inspect, hypothesize, patch, compile and validate is designed to close around the failure and patch it, so the build can run on to a validated artifact.',
      caption: 'Illustration: how the agent is designed to work, on example failures; the project is in progress and has no results yet.',
    },
  },
  {
    id: 'comcast',
    title: 'Ad serving on Kubernetes',
    organization: 'Comcast',
    role: 'Site Reliability Engineering / DevOps Intern',
    dates: 'June 2025 – August 2025',
    location: 'Remote',
    summary: 'Migrated the Sprinkler ad-serving platform from EC2 Auto Scaling Groups to Kubernetes on Amazon EKS, automated its deployment and scaling, and built its SLO dashboards.',
    figures: [
      { value: 'EC2 to EKS', label: 'platform migration', detail: 'across multiple environments' },
      { value: 'Zero', label: 'manual scaling steps', detail: 'Helm, ArgoCD, and KEDA autoscaling' },
      { value: '99.99%', label: 'availability target', detail: 'supported by multi-AZ redundancy' },
    ],
    facts: [
      { label: 'Problem', text: 'Sprinkler, an ad-serving platform, ran on EC2 Auto Scaling Groups, and scaling it took manual intervention.' },
      { label: 'Contribution', text: 'Migrated it to Kubernetes on EKS and automated deployment and dynamic scaling with Helm charts, ArgoCD pipelines, and KEDA autoscaling.' },
      { label: 'Reliability', text: 'Partnered with the DPE and platform teams on multi-AZ redundancy supporting a 99.99% availability target, and built standardized metrics and SLO dashboards with Prometheus, Grafana Cloud, and Telegraf sidecars.' },
      { label: 'Result', text: 'Eliminated manual intervention in scaling workflows and improved scalability and reliability across multiple environments.' },
    ],
    tools: ['Amazon EKS', 'Kubernetes', 'Helm', 'ArgoCD', 'KEDA', 'Prometheus', 'Grafana'],
    details: [],
    links: [],
    visual: {
      name: 'Comcast',
      label: 'Illustration: EC2 Auto Scaling Groups, whose scaling took manual intervention, move onto Kubernetes on Amazon EKS, spread across availability zones and deployed with Helm and ArgoCD. As load rises and falls, KEDA adds and removes pods on its own.',
      caption: 'Illustration: every count, the manual step and the load are schematic.',
    },
  },
  {
    id: 'terrier-motorsport',
    title: 'Precharge-capable PCB design',
    organization: 'Terrier Motorsport · BU Formula SAE Electric',
    role: 'PCB design and low-voltage review',
    dates: 'January 2024 – Present',
    summary: 'Worked on the design and assembly of precharge-capable PCBs, and reviewed low-voltage designs for power transfer and operator safety.',
    figures: [],
    facts: [
      { label: 'Team', text: 'Boston University students design, build, and race a fully electric formula-style car.' },
    ],
    tools: [],
    details: [],
    links: [{ label: 'Terrier Motorsport', href: 'https://sites.bu.edu/butm/' }],
    visual: {
      name: 'Terrier Motorsport',
      label: 'Illustration: a precharge circuit. One accumulator isolation relay, AIR−, closes, then the precharge relay sends current through a resistor into the motor controller’s DC-link capacitor. On the plot the capacitor voltage climbs while the current falls; at 90% of pack voltage the other isolation relay, AIR+, closes and the precharge relay opens.',
      caption: 'Illustration: the team’s precharge order and 90% threshold on a simplified circuit; the curves are ideal, not measured data.',
    },
  },
  {
    id: 'rocket-propulsion',
    title: 'Thruster design and review',
    organization: 'Boston University Rocket Propulsion Group',
    role: 'Thruster design',
    dates: 'January 2024 – Present',
    summary: 'Contributed to thruster design on a six-person team, and presented the preliminary and critical design reviews that secured approval for construction and testing.',
    figures: [],
    facts: [
      { label: 'Team', text: 'The BU Rocket Propulsion Group is an undergraduate group that designs, builds, and launches rockets.' },
    ],
    tools: [],
    details: [],
    links: [{ label: 'BU Rocket Propulsion Group', href: 'https://burpg.org/' }],
    visual: {
      name: 'Rocket Propulsion Group',
      label: 'Illustration: a cross-section of a generic converging–diverging thruster. Flow moves slowly through the chamber, speeds up as the nozzle narrows, reaches the speed of sound at the throat, and leaves supersonic, with shock diamonds in the plume.',
      caption: 'Illustration: how a converging–diverging nozzle, the kind the team designed, works. A generic shape, not the team’s geometry or a test firing.',
    },
  },
];
