export type ServicePage = {
  slug:
    | "generator-service"
    | "generator-maintenance"
    | "generator-repair"
    | "generator-installation"
    | "generac-generator-service";
  path: string;
  /** Title segment. The root template adds the business name. */
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lede: string;
  paragraphs: readonly [string, string];
  includesTitle: string;
  includes: readonly string[];
};

export const SERVICE_PAGES: readonly ServicePage[] = [
  {
    slug: "generator-service",
    path: "/generator-service",
    title: "Generator Service",
    description:
      "On-site generator service for Florida homes and businesses: Generac install, scheduled maintenance, and 24/7 repair. Call (386) 631-8982.",
    eyebrow: "Central & South Florida",
    h1: "Generator Service in Central & South Florida",
    lede:
      "Generator service here means a technician at your property — not a national ranking and not a parts counter. We install, maintain, and repair Generac home standby generators from the Orlando area through the southeast coast.",
    paragraphs: [
      "A service visit starts with how the unit is behaving. Some calls are a missed exercise cycle or a battery that gave up after a humid summer. Others are a transfer switch that never handed the house back to the utility, or a first conversation about putting a generator where there isn’t one yet. We say which of those you are in before anyone sells a part.",
      "Storm weeks fill the schedule, so maintenance in the quiet months is what keeps a repair from becoming an outage. If you already know you need an oil service, a breakdown diagnosis, or a new installation, use those pages. If you are not sure, call (386) 631-8982 or send the property details through the estimate form and we will point you to the right visit.",
    ],
    includesTitle: "What a generator service visit can cover",
    includes: [
      "Listening to the last exercise cycle and any Mobile Link alerts before we open the enclosure",
      "Deciding whether the job is maintenance, a repair, or a quote for a new standby system",
      "Natural gas and liquid propane home standby units, sized around the circuits you actually need",
      "A written next step, with the estimate form one click away if the work is larger than a service call",
    ],
  },
  {
    slug: "generator-maintenance",
    path: "/generator-maintenance",
    title: "Generator Maintenance",
    description:
      "Generator maintenance every six months: oil, filters, battery, and exercise checks for Generac standby units in Florida. Call (386) 631-8982.",
    eyebrow: "Prevent the outage",
    h1: "Generator Maintenance in Central & South Florida",
    lede:
      "Home standby generators sit outside in salt, sun, and afternoon rain. Maintenance is the oil, filters, battery, and exercise test that keep that machine ready before a hurricane or a random feeder fault.",
    paragraphs: [
      "We recommend a maintenance visit about every six months, which matches the ownership note on our homepage. One visit usually lands before hurricane season and one after the summer storms. The technician changes the oil and filter, checks the battery and charger, looks at hoses and the enclosure for corrosion, and confirms the unit will start and transfer on its own.",
      "Maintenance plans are for people who do not want a calendar reminder. Remote monitoring helps between visits: when a Generac reports an error, an authorized dealer can see it instead of discovering a dead unit the night the lights go out. Maintenance is not a repair and it is not an installation — if we find a failed component, we tell you before that work starts.",
    ],
    includesTitle: "What scheduled maintenance includes",
    includes: [
      "Oil and filter service on the interval your Generac manual and our six-month recommendation call for",
      "Battery, charger, and exercise-cycle check so a weekly test is actually happening",
      "Enclosure, coolant, and hose inspection where Florida heat and salt air show up first",
      "A note of anything that should become a repair instead of waiting for the next storm",
    ],
  },
  {
    slug: "generator-repair",
    path: "/generator-repair",
    title: "Generator Repair",
    description:
      "24/7 generator repair for Generac standby units that will not start, transfer, or stay running in Florida. Call (386) 631-8982.",
    eyebrow: "24/7 emergency repair",
    h1: "Generator Repair in Central & South Florida",
    lede:
      "When a standby generator will not start, starts and shuts down, or never switches the house, that is a repair — and outages do not wait for business hours. Certified technicians are available 24/7.",
    paragraphs: [
      "Typical failures we are called for: no crank after an exercise, an error code on the controller, a unit that runs then faults, or an automatic transfer switch that does not move the load. We diagnose on site. We do not publish a do-it-yourself bypass for the transfer switch or the fuel line; those connections are why Generac points owners to a dealer.",
      "Emergency repair is different from a maintenance plan and from a new installation. If the generator is down during a storm, say that when you call (386) 631-8982 so we can triage it ahead of routine oil changes. If the unit is older than the house’s needs, we will say so and you can request an installation estimate instead of repeating the same repair.",
    ],
    includesTitle: "Repair calls we take",
    includes: [
      "No-start, shutdown, and controller error codes on Generac home standby generators",
      "Transfer switches that fail to pick up the house or fail to return it to utility power",
      "24/7 response when the outage is already underway",
      "A clear line between a part replacement and a system that should be replaced",
    ],
  },
  {
    slug: "generator-installation",
    path: "/generator-installation",
    title: "Generator Installation",
    description:
      "Generac generator installation in Florida: sizing, permits, gas or propane, transfer switch, and startup. Call (386) 631-8982.",
    eyebrow: "New standby systems",
    h1: "Generator Installation in Central & South Florida",
    lede:
      "A new Generac home standby generator is a construction project on the side of the house: pad, fuel, automatic transfer switch, permits, and a startup. We run that project so it does not land on you as a stack of contractors.",
    paragraphs: [
      "Installation begins with the circuits you want alive — air conditioning, refrigeration, a well, medical equipment — and the fuel you already have. Natural gas and liquid propane are both normal here; rural lots in places like Ocala often have propane, while many city lots have gas. We size the unit around that load instead of guessing from a square-footage chart.",
      "The rest of the job is local: a permit, an electrical connection, fuel piping, a pad that respects setbacks and flood concerns, and a startup once inspection allows. Homeowners can do some site prep, but panel work and fuel hookups belong with a licensed dealer. Get an estimate online or call (386) 631-8982 and we will walk the property before anyone orders equipment.",
    ],
    includesTitle: "What installation covers",
    includes: [
      "Load conversation and a Generac home standby unit matched to gas or propane",
      "Permits, transfer switch, surge protection, and the management of large loads such as HVAC",
      "Pad placement that accounts for Florida setbacks, drainage, and salt exposure near the coast",
      "Startup after inspection, then a handoff into maintenance so the first year is not neglected",
    ],
  },
  {
    slug: "generac-generator-service",
    path: "/generac-generator-service",
    title: "Generac Generator Service",
    description:
      "Generac generator service from an authorized Florida dealer: install, Mobile Link, maintenance, and 24/7 repair. Call (386) 631-8982.",
    eyebrow: "Authorized Generac dealer",
    h1: "Generac Generator Service in Central & South Florida",
    lede:
      "Generac generator service is the dealer work around a Generac home standby unit: sizing and installation, six-month maintenance, Mobile Link alerts, and 24/7 repair when the controller throws a code.",
    paragraphs: [
      "Generac built the home standby category and remains the brand we install and maintain. Air-cooled units cover most houses; larger homes sometimes need a liquid-cooled set. Either way, the dealer side is the same: permits, a transfer switch, an exercise schedule, and someone who can read the fault instead of clearing it and hoping.",
      "Mobile Link lets you see status on a phone, and as your local dealer we can be alerted when the unit reports a problem. That is Generac-specific service, separate from a generic handyman call. We do this work across Central and South Florida. Call (386) 631-8982.",
    ],
    includesTitle: "Generac work we handle",
    includes: [
      "Authorized-dealer installation of Generac home standby generators on natural gas or propane",
      "Maintenance and repairs on Generac controllers, enclosures, and transfer switches",
      "Mobile Link monitoring so an error is not a surprise during the next outage",
      "City-by-city service pages if you want the same work described for your town",
    ],
  },
] as const;

export function getService(slug: string): ServicePage | undefined {
  return SERVICE_PAGES.find((service) => service.slug === slug);
}

export function requireService(slug: ServicePage["slug"]): ServicePage {
  const service = getService(slug);
  if (!service) throw new Error(`Missing service page ${slug}`);
  return service;
}
