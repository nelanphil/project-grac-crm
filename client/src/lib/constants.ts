export const ESTIMATE_ROUTE = "/estimate";

export const COMPANY = {
  name: "Generator Maintenance of Florida",
  shortName: "GMF",
  tagline: "Expert Backup Power for Central & South Florida",
  phone: "(407) 555-0199",
  phoneHref: "tel:+14075550199",
  email: "info@generatormaintenancefl.com",
  license: "Licensed & Insured",
} as const;

export const NAV_LINKS = [
  { label: "Services", href: "/#services" },
  { label: "Why Us", href: "/#why-us" },
  { label: "Generac", href: "/#generac" },
  { label: "FAQ", href: "/#faq" },
  { label: "Service Areas", href: "/#service-areas" },
] as const;

export const SERVICES = [
  {
    title: "Installation",
    description:
      "Expert standby generator installation for natural gas and propane systems, sized for your home or business.",
    icon: "install",
  },
  {
    title: "Repairs",
    description:
      "Factory-trained technicians diagnose and repair Generac home standby generators fast.",
    icon: "repair",
  },
  {
    title: "Maintenance & Monitoring",
    description:
      "Preventative maintenance and remote monitoring so we catch issues before they become costly breakdowns.",
    icon: "monitor",
  },
] as const;

export const GENERAC_HOME_STANDBY = {
  overview:
    "A permanently installed Generac home standby generator does more than keep the lights on when the power fails — it delivers peace of mind. Units are installed outside your home like a central A/C system and run on natural gas or liquid propane, keeping you safe, secure, and comfortable during outages across Central and South Florida.",
  learnMoreUrl: "https://www.generac.com/home-standby-generators/",
  howItWorksIntro:
    "Your home standby generator is installed outside your home like a central A/C unit and runs on natural gas or liquid propane (LP), depending on what fuel source is available. All home standby solutions are designed to keep you safe, secure and comfortable in an outage.",
  howItWorks: [
    {
      step: 1,
      label: "01",
      title: "Utility power is lost",
      description:
        "Whether from a storm, equipment failure, or any number of other causes, you suddenly find yourself without electricity.",
    },
    {
      step: 2,
      label: "02",
      title: "Generator senses a problem",
      description:
        "Thanks to the transfer switch technology, your backup generator can start supplying power to your home seconds after an outage begins.",
    },
    {
      step: 3,
      label: "03",
      title: "Generator restores power",
      description:
        "Whether you're home or not, your Generac home standby system kicks into action, and continues to power your home until utility power returns.",
    },
  ],
  benefits: [
    {
      title: "#1 Home Standby Generator in North America",
      description:
        "Generac pioneered the home standby category in 1959. Today, 8 in 10 homeowners with backup power have chosen Generac.",
    },
    {
      title: "24/7/365 Support When You Need It",
      description:
        "Outages don't follow a schedule. Generac and authorized dealers like us provide support around the clock for service and emergencies.",
    },
    {
      title: "Local Authorized Installation & Service",
      description:
        "As your local Generac authorized dealer, we handle site evaluation, permits, installation, maintenance, and repairs — configured for your home.",
    },
  ],
  maintenanceNote:
    "All generators require periodic maintenance — oil and filter changes — to ensure maximum performance and years of reliable service. We recommend servicing every 6 months and offer maintenance plans for worry-free ownership.",
} as const;

export const SYSTEM_INCLUDES = [
  {
    title: "Surge Protector",
    description:
      "Guards the transfer switch, generator, and your home from damaging voltage surges.",
  },
  {
    title: "Automatic Transfer Switch",
    description:
      "Seamlessly shifts your power supply from the grid to your generator during outages.",
  },
  {
    title: "Management Module",
    description:
      "Prevents overloads by prioritizing essential circuits and managing large loads like HVAC units.",
  },
] as const;

export const UPGRADES = [
  {
    title: "Mobile Link™ Remote Monitoring",
    description:
      "Monitor your generator from anywhere on your smartphone, tablet, or PC. As your local authorized dealer, we receive immediate alerts when error codes are reported.",
  },
] as const;

export const FAQS = [
  {
    question: "What areas does Generator Maintenance of Florida serve?",
    answer:
      "We provide home and commercial standby generator installation, maintenance, and repair throughout Central and South Florida — from Orlando and Tampa to Miami, Fort Lauderdale, and Naples.",
  },
  {
    question: "What types of generators do you install and service?",
    answer:
      "We specialize in Generac home standby generators for residential and commercial properties, covering both natural gas and liquid propane systems. As an authorized Generac dealer, we handle sizing, installation, maintenance, and repair.",
  },
  {
    question: "Do home standby generators require maintenance?",
    answer:
      "Yes. All generators require periodic maintenance such as oil and filter changes to ensure maximum performance and years of reliable service. We recommend servicing every 6 months and offer maintenance plans for worry-free ownership.",
  },
  {
    question: "Can I install a Generac generator myself?",
    answer:
      "While some site preparation steps can be done by homeowners, Generac recommends using an authorized dealer or licensed contractor for electrical panel connections, fuel hookups, and full installation to meet local codes and ensure safe, reliable operation. We handle the entire process for you.",
  },
  {
    question: "How quickly will my generator turn on during a power outage?",
    answer:
      "With a Generac home standby generator and automatic transfer switch, power is restored within approximately 10 to 30 seconds after an outage is detected, keeping essential systems running with minimal disruption.",
  },
  {
    question: "Do you offer emergency generator service and repairs?",
    answer:
      "Yes. Our certified generator technicians are available 24/7 for emergency service to diagnose issues, perform repairs, and ensure your backup power system operates reliably when you need it most.",
  },
  {
    question: "Why should I choose Generator Maintenance of Florida?",
    answer:
      "We are a licensed and insured, Generac authorized dealer with experienced technicians who handle the full process — permits, electrical work, plumbing, installation, and final startup — plus preventative maintenance and wireless monitoring across Central and South Florida.",
  },
] as const;

export const SERVICE_AREAS = {
  central: [
    "Orlando",
    "Tampa",
    "Lakeland",
    "Kissimmee",
    "Winter Park",
    "Clermont",
    "Sanford",
    "Ocala",
    "Daytona Beach",
    "The Villages",
    "Lake Mary",
    "Deltona",
  ],
  south: [
    "Miami",
    "Fort Lauderdale",
    "West Palm Beach",
    "Boca Raton",
    "Naples",
    "Fort Myers",
    "Sarasota",
    "Hollywood",
    "Coral Gables",
    "Pompano Beach",
    "Jupiter",
    "Port St. Lucie",
  ],
} as const;

export const FOOTER_LINKS = {
  Services: [
    { label: "Installation", href: "/#services" },
    { label: "Repairs", href: "/#services" },
    { label: "Maintenance", href: "/#services" },
    { label: "Emergency Service", href: "/#faq" },
  ],
  Company: [
    { label: "Why Choose Us", href: "/#why-us" },
    { label: "Generac Home Standby", href: "/#generac" },
    { label: "Service Areas", href: "/#service-areas" },
    { label: "FAQ", href: "/#faq" },
  ],
  Contact: [
    { label: COMPANY.phone, href: COMPANY.phoneHref },
    { label: COMPANY.email, href: `mailto:${COMPANY.email}` },
  ],
} as const;

export const US_STATES = [
  "Florida",
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
] as const;
