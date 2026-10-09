export type CityCopy = {
  description: string;
  lede: string;
  paragraphs: readonly [string, string];
  notesTitle: string;
  notes: readonly [string, string, string];
  nearby: readonly string[];
};

/**
 * Local facts only: geography, housing, fuel, and storm exposure.
 * No street address and no national ranking for "generator service".
 */
export const CITY_COPY: Record<string, CityCopy> = {
  orlando: {
    description:
      "Generator service in Orlando for standby units around the theme parks, Lake Nona, and older neighborhoods. Generac install and 24/7 repair. (386) 631-8982.",
    lede:
      "Orlando generator service is mostly inland houses that lose power to lightning and summer squalls, plus vacation homes whose owners are not in town when the unit faults.",
    paragraphs: [
      "Orange County work splits between older blocks near downtown and College Park and newer roofs out toward Lake Nona. Theme-park corridors add a lot of rental houses that need the generator to exercise even when nobody is sleeping there. We treat those as maintenance problems first: a dead battery found in June is cheaper than a no-start during a holiday outage.",
      "Air conditioning is usually the load that decides the size. A Generac installation here still means a permit, a transfer switch, and either natural gas or propane. If the unit is already in place, generator repair and six-month maintenance are the visits that keep it from becoming a lawn ornament.",
    ],
    notesTitle: "What we watch for in Orlando",
    notes: [
      "Rental and second homes where Mobile Link is the only way anyone hears about a fault",
      "Afternoon thunderstorms that knock feeders out without a hurricane on the map",
      "HOA pads in newer subdivisions that need approval before an install date is real",
    ],
    nearby: ["winter-park", "kissimmee", "sanford"],
  },
  tampa: {
    description:
      "Tampa generator service for bay-side houses and inland suburbs. Generac maintenance, installation, and 24/7 repair across Hillsborough. Call (386) 631-8982.",
    lede:
      "Tampa generator service has to respect the bay. Salt air, flood-prone lots, and a mix of South Tampa bungalows and newer northern suburbs are not the same job.",
    paragraphs: [
      "South Tampa and the neighborhoods closer to the water punish enclosures and batteries. A maintenance visit there includes corrosion, not just an oil filter. Farther inland, in places such as Westchase and New Tampa, the houses are newer, the yards are planned, and the usual delay is architectural approval plus a utility gas meter that may need an upgrade before we can pipe the unit.",
      "Hillsborough outages come from both named storms and ordinary summer lightning. We install Generac home standby systems, then stay on them for repair and the six-month service. The visit is at the house, whether the unit is new or the one already sitting by the garage.",
    ],
    notesTitle: "What we watch for in Tampa",
    notes: [
      "Salt and humidity on units installed close to the bay",
      "Flood elevation when a pad is planned on a low lot",
      "Gas-meter capacity before a large air-conditioning load is added",
    ],
    nearby: ["lakeland", "sarasota", "orlando"],
  },
  lakeland: {
    description:
      "Lakeland generator service between Tampa and Orlando: lake-lot homes, older block houses, and new south-side subdivisions. Call (386) 631-8982.",
    lede:
      "Lakeland sits on the I-4 ridge of lakes between the two coasts. Generator service here is less about salt and more about lightning, older electrical panels, and yards that slope toward a lake.",
    paragraphs: [
      "Polk County houses range from mid-century block homes with panels that were never planned for a transfer switch to newer subdivisions south of town. Lake lots look generous until the setback from the water and the drainage path for a concrete pad are drawn. We sort that out before equipment is ordered.",
      "Because Lakeland is inland, owners sometimes assume standby power is only a coastal problem. The feeders still drop in summer storms, and a generator that has not been exercised will not care that the Gulf is an hour away. Maintenance every six months is the local habit we push.",
    ],
    notesTitle: "What we watch for in Lakeland",
    notes: [
      "Older panels that need a realistic transfer-switch plan",
      "Pads on lake lots where drainage and setbacks come first",
      "Owners who skipped exercise cycles because storms felt “inland”",
    ],
    nearby: ["tampa", "orlando", "clermont"],
  },
  kissimmee: {
    description:
      "Kissimmee generator service for vacation rentals and Osceola homes near the parks. Generac install, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Kissimmee generator service is shaped by short-term rentals. The person who gets the fault is often a guest, and the owner is somewhere else.",
    paragraphs: [
      "Osceola County, including areas toward Poinciana and Four Corners, has a heavy mix of vacation houses and primary homes. A rental needs a generator that exercises itself and a monitoring alert that reaches the owner, not a binder left in a drawer. We set maintenance around that reality.",
      "Installation still has to survive county permitting and the air-conditioning load guests expect to keep running. If a unit is already failing on changeover weekends, that is a repair call — 24/7 — rather than waiting for the next turnover to discover it.",
    ],
    notesTitle: "What we watch for in Kissimmee",
    notes: [
      "Absentee owners who need Mobile Link more than a magnet on the fridge",
      "Guest expectations that cooling stays on through an outage",
      "Clusters of similar houses where one neglected unit predicts the neighbors",
    ],
    nearby: ["orlando", "clermont", "winter-park"],
  },
  "winter-park": {
    description:
      "Winter Park generator service for canopy-shaded historic homes and tight side yards. Generac installation, maintenance, and repair. (386) 631-8982.",
    lede:
      "Winter Park generator service is a fit problem as much as an electrical one. Brick streets, oak canopy, and smaller side yards leave less room for a pad than a new subdivision does.",
    paragraphs: [
      "Historic houses and the neighborhoods under the canopy often have mature trees that the city and the neighbors care about. We plan the pad and the exhaust clearance around that, instead of treating the lot like a blank suburban side yard. Permits and any design review are part of the installation quote.",
      "These are also homes where people live year-round and notice a missed exercise cycle. Maintenance is straightforward once the unit is in; the hard part was getting it placed without fighting the trees or the property line. Repair calls are the same Generac faults we see elsewhere, just on equipment tucked into a tighter footprint.",
    ],
    notesTitle: "What we watch for in Winter Park",
    notes: [
      "Tight side yards and exhaust clearance under large oaks",
      "Older homes whose panels need a careful transfer-switch layout",
      "Local review of exterior equipment before a pad is poured",
    ],
    nearby: ["orlando", "lake-mary", "sanford"],
  },
  clermont: {
    description:
      "Clermont generator service in Lake County’s growing hills: new communities and ridge-top homes. Generac install and 24/7 repair. (386) 631-8982.",
    lede:
      "Clermont generator service follows the rooftops going up on the Lake County hills south of State Road 50, not a beach evacuation map.",
    paragraphs: [
      "A lot of the housing is master-planned and new enough that a standby generator was an option the builder never included. Adding one later means HOA paperwork, a gas or propane decision, and a pad on lots that can be steeper than coastal fill. We walk that before ordering a Generac.",
      "The hills do not exempt anyone from lightning outages. New units still need the six-month maintenance habit, and a controller fault is still a repair. Owners closer to the Orlando side of the county often ask about both installation and a plan so the first hurricane season is not the first service.",
    ],
    notesTitle: "What we watch for in Clermont",
    notes: [
      "HOA architectural packets on newer communities",
      "Sloped lots where a level pad takes more thought",
      "First-time standby owners who have never funded an oil service",
    ],
    nearby: ["orlando", "lakeland", "kissimmee"],
  },
  sanford: {
    description:
      "Sanford generator service along Lake Monroe and in newer Seminole subdivisions. Generac maintenance, installation, and 24/7 repair. (386) 631-8982.",
    lede:
      "Sanford generator service covers the historic streets near downtown and the newer subdivisions that grew toward Lake Mary, with lake humidity in both.",
    paragraphs: [
      "Seminole County’s river and lake air is hard on batteries and enclosures even though this is not a barrier island. We look for that on maintenance visits. Downtown-adjacent houses can have older services; the newer tracts usually have more yard and an HOA.",
      "Installation quotes separate those two housing stocks on purpose. A transfer switch in a renovated older home is a different day from a pad in a subdivision with a standard setback. Repair availability is 24/7 either way when the unit will not carry the house.",
    ],
    notesTitle: "What we watch for in Sanford",
    notes: [
      "Humidity off Lake Monroe showing up as corrosion and weak batteries",
      "Older downtown-area services versus newer subdivision pads",
      "Owners who commute to Orlando and want faults reported remotely",
    ],
    nearby: ["lake-mary", "deltona", "winter-park"],
  },
  ocala: {
    description:
      "Ocala generator service for horse-farm acreage and city lots in Marion County, including propane where there is no gas main. (386) 631-8982.",
    lede:
      "Ocala generator service reaches farther north than our coastal towns, onto acreage where the fuel is often a propane tank rather than a city gas meter.",
    paragraphs: [
      "Marion County mixes in-town neighborhoods with horse properties and long driveways. On those rural lots a natural-gas assumption is usually wrong. We size the Generac around propane delivery and the loads that matter there: wells, barns’ essential circuits, and the house air conditioner, not a generic suburban package.",
      "Lightning still takes the lines down away from the coast. Because technicians are covering more distance, maintenance plans matter: an oil service booked ahead beats a no-start discovered when a storm is already on the farm. Repair calls remain 24/7 when the unit is down.",
    ],
    notesTitle: "What we watch for in Ocala",
    notes: [
      "Propane tanks and delivery schedules on properties without a gas main",
      "Long driveways and outbuildings that change which circuits are essential",
      "Longer travel, so scheduled maintenance is more reliable than a last-minute hope",
    ],
    nearby: ["the-villages", "sanford", "deltona"],
  },
  "daytona-beach": {
    description:
      "Daytona Beach generator service for beachside and mainland homes. Salt-air maintenance, Generac installation, and 24/7 repair. (386) 631-8982.",
    lede:
      "Daytona Beach generator service is a salt-air market on the Atlantic, with beachside buildings and mainland neighborhoods that do not share the same flood or corrosion problems.",
    paragraphs: [
      "Beachside equipment lives in salt. Enclosures, fasteners, and batteries age faster than they do in Deltona or Orlando, so maintenance here is not optional window dressing. We also separate condo properties, which often cannot accept a residential standby set, from single-family lots that can.",
      "Hurricane tracks favor this coast, and a lot of our calls already start in Volusia. Installation still runs through permits and a transfer switch. If the generator failed during the last storm, call (386) 631-8982 for repair before the next one.",
    ],
    notesTitle: "What we watch for in Daytona Beach",
    notes: [
      "Salt corrosion on beachside enclosures and batteries",
      "Flood and access differences between the peninsula and the mainland",
      "Associations that allow a standby unit versus towers that do not",
    ],
    nearby: ["new-smyrna-beach", "deltona", "sanford"],
  },
  "new-smyrna-beach": {
    description:
      "New Smyrna Beach generator service for island and mainland homes. Salt, surge, and smaller lots shape Generac installs and 24/7 repair. (386) 631-8982.",
    lede:
      "New Smyrna Beach generator service covers a barrier-island town and its mainland side, where lot size, surge, and salt air change the job from one street to the next.",
    paragraphs: [
      "The island side deals with surge, flood elevation, and equipment that has to live in salt spray. Pads and platforms are planned around that, not copied from an inland subdivision detail. Mainland lots usually have more room and less spray, but they still sit in a hurricane corridor and still need a real exercise cycle.",
      "Many properties are smaller than a west-Florida estate, so exhaust clearance and neighbor walls matter during installation. We are the same Generac dealer for maintenance and 24/7 repair, and we schedule the visit at the house. Call (386) 631-8982.",
    ],
    notesTitle: "What we watch for in New Smyrna Beach",
    notes: [
      "Island lots where elevation and salt spray decide pad placement",
      "Tight setbacks and exhaust clearance on smaller parcels",
      "Mainland homes that still need hurricane-season maintenance",
    ],
    nearby: ["daytona-beach", "deltona", "sanford"],
  },
  "the-villages": {
    description:
      "The Villages generator service for deed-restricted homes, including residents who need backup for medical equipment. Call (386) 631-8982.",
    lede:
      "Generator service in The Villages is about deed restrictions and people who cannot sit through a long outage, not about beach corrosion.",
    paragraphs: [
      "Architectural review is part of almost every installation conversation here. A pad, a fence screen, or an exhaust direction that would pass in an unincorporated subdivision can stall until the community signs off. We build that wait into the schedule instead of promising a pour date we do not control.",
      "A large share of residents rely on medical equipment, refrigeration, or simply staying cool. That makes a missed maintenance visit more serious than it is for a vacation rental. We push six-month oil service and Mobile Link so a fault is known before the weekly golf-cart routine is interrupted by a dark house. Repair is available 24/7 when the unit is already down.",
    ],
    notesTitle: "What we watch for in The Villages",
    notes: [
      "Architectural approval before a generator pad is scheduled",
      "Medical and cooling loads that make runtime non-negotiable",
      "Owners who travel and need a remote alert, not a porch conversation",
    ],
    nearby: ["ocala", "clermont", "sanford"],
  },
  "lake-mary": {
    description:
      "Lake Mary generator service for Heathrow, Timacuan, and the I-4 family suburbs. Generac installation, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Lake Mary generator service sits in Seminole County’s corporate corridor: newer two-story houses, planned communities, and commuters who are not home when an exercise cycle fails.",
    paragraphs: [
      "Heathrow, Timacuan, and the surrounding subdivisions tend to have HOAs, irrigation, and air-conditioning loads that dominate the sizing conversation. Natural gas is common, which makes installation cleaner than a propane delivery route, as long as the meter can feed the unit.",
      "These households notice a transfer that fails because someone is working from home or a child is mid-homework. Maintenance is the scheduled visit; Mobile Link covers the weeks in between. Call (386) 631-8982 when the fault cannot wait for that visit.",
    ],
    notesTitle: "What we watch for in Lake Mary",
    notes: [
      "HOA packets in Heathrow, Timacuan, and similar communities",
      "Gas service size when the air conditioner is on the backed-up load",
      "Daytime outages that interrupt people working in the house",
    ],
    nearby: ["sanford", "winter-park", "orlando"],
  },
  deltona: {
    description:
      "Deltona generator service for southwest Volusia’s lake neighborhoods. Generac maintenance, installation, and 24/7 repair. Call (386) 631-8982.",
    lede:
      "Deltona generator service is inland Volusia: a large city of residential lakes between the river and Daytona, with working households rather than a tourist strip.",
    paragraphs: [
      "Lots here are often on or near lakes, so drainage and a level pad matter, but salt spray is not the story the way it is in Daytona Beach or New Smyrna Beach. Panels and fuel vary street by street. We look at the actual house instead of assuming every Deltona roof matches its neighbor.",
      "The 386 area code on our phone is the same one local residents dial, and the appointment is at the house. Six-month maintenance keeps units ready for the storms that still take this part of the county offline, and repair is 24/7 when a controller or transfer switch has already failed.",
    ],
    notesTitle: "What we watch for in Deltona",
    notes: [
      "Lake-lot drainage before a pad is committed",
      "A mix of panel ages across a city built in phases",
      "Households that want a local phone number and an on-site visit, not a national call center",
    ],
    nearby: ["daytona-beach", "new-smyrna-beach", "sanford"],
  },
  miami: {
    description:
      "Miami generator service for single-family homes under stricter wind rules. Generac installation, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Miami generator service is aimed at single-family houses. Most high-rises cannot take a residential standby set, and Miami-Dade anchoring rules are stricter than inland counties.",
    paragraphs: [
      "Kendall, Coral Way, and similar neighborhoods are the usual fit: a yard, a fuel source, and a permit path that includes wind-borne debris and tie-down expectations you will not see in Ocala. We quote installation with that permitting in mind. Salt air still applies east of the city, so maintenance includes corrosion, not only oil.",
      "A Generac that will not transfer during a summer storm is a repair, and those calls are 24/7. Call (386) 631-8982 and name the neighborhood so we know whether salt air is part of the visit.",
    ],
    notesTitle: "What we watch for in Miami",
    notes: [
      "High-Velocity Hurricane Zone anchoring and shutter-era permitting",
      "Houses rather than condo towers for residential standby units",
      "Salt exposure that varies from the bay to the western suburbs",
    ],
    nearby: ["coral-gables", "hollywood", "fort-lauderdale"],
  },
  "fort-lauderdale": {
    description:
      "Fort Lauderdale generator service for canal and inland homes in Broward. Flood-aware Generac installs, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Fort Lauderdale generator service has to account for canals. A waterfront generator that sits too low is a different failure than an inland unit that simply missed an oil change.",
    paragraphs: [
      "Las Olas and the finger canals mean flood elevation, seawalls, and access for a pad that will not be underwater in the first surge. Western Broward suburbs are drier and more like a standard installation, with HOAs and gas meters as the usual constraints. We do not write one scope for both.",
      "Salt and humidity still reach a long way inland here. Maintenance every six months is how enclosures survive, and 24/7 repair is how we handle a transfer switch that failed after the last named storm. Call (386) 631-8982 to put the property on the schedule.",
    ],
    notesTitle: "What we watch for in Fort Lauderdale",
    notes: [
      "Canal lots where the pad elevation is part of the design",
      "Inland communities where the constraint is the HOA, not the seawall",
      "Corrosion on units that owners assumed were “far enough from the beach”",
    ],
    nearby: ["pompano-beach", "hollywood", "boca-raton"],
  },
  "west-palm-beach": {
    description:
      "West Palm Beach generator service from the Intracoastal to western communities. Generac install, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "West Palm Beach generator service stretches from Intracoastal lots to the western communities, and those are different permits, flood risks, and yards.",
    paragraphs: [
      "Closer to the water, installation planning includes flood and salt. Farther west, along the communities that grew out the Beeline corridor, the work looks more like a large-lot suburban install with HOA review and a serious air-conditioning load. Quoting them the same way wastes a month.",
      "Palm Beach County storms do not only hit the barrier islands. A maintained Generac on the mainland still has to start. We handle that maintenance, plus 24/7 repair, and new installations when the house has never had standby power.",
    ],
    notesTitle: "What we watch for in West Palm Beach",
    notes: [
      "Intracoastal flood and salt versus drier western lots",
      "HOA reviews that move the install date more than the electrical work does",
      "Cooling loads that decide the generator size more than square footage does",
    ],
    nearby: ["boca-raton", "jupiter", "fort-lauderdale"],
  },
  "boca-raton": {
    description:
      "Boca Raton generator service for gated communities east and west of I-95. Generac installation, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Boca Raton generator service usually starts with a gatehouse and an architectural committee, then gets to the generator.",
    paragraphs: [
      "East of I-95 the lots are older and closer to salt air. West of I-95 the communities are larger, newer, and strict about where equipment can be seen. Both need a Generac installed to code; only the paperwork and the corrosion risk match. We ask which community before we talk pad dimensions.",
      "Once the unit is in, the six-month maintenance visit is what the committee will never remind you to book. Mobile Link covers alerts between visits. If the generator failed to carry the house, that is a 24/7 repair call at (386) 631-8982, not a request to wait for the next board meeting.",
    ],
    notesTitle: "What we watch for in Boca Raton",
    notes: [
      "Architectural standards that differ east and west of I-95",
      "Screening and placement rules before a pad is poured",
      "Salt air on the eastern lots that maintenance has to treat directly",
    ],
    nearby: ["fort-lauderdale", "west-palm-beach", "pompano-beach"],
  },
  naples: {
    description:
      "Naples generator service for high-water-table lots and post-storm Collier County homes. Generac install, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Naples generator service deals with a high water table and a coast that has already seen what a major hurricane does to standby equipment.",
    paragraphs: [
      "Collier County pads often cannot be an afterthought poured in a low swale. Coastal estates and inland golf communities both flood in different ways, and salt reaches equipment that owners think of as “inside the gate.” Installation quotes include elevation and anchoring, not only the generator model.",
      "After a storm, the calls split between units that ran and now need service and units that never started. We would rather have done the oil and battery visit beforehand. Repair is 24/7 when you are in the second group. Scheduling is by phone or the estimate form.",
    ],
    notesTitle: "What we watch for in Naples",
    notes: [
      "High water table and pad elevation on coastal and golf-community lots",
      "Salt behind the gates, not only on the beach road",
      "A backlog mindset after hurricanes — maintenance is the way out of it",
    ],
    nearby: ["fort-myers", "sarasota", "miami"],
  },
  "fort-myers": {
    description:
      "Fort Myers generator service for Lee County homes along the Caloosahatchee and in rebuilt neighborhoods. Generac install and 24/7 repair. (386) 631-8982.",
    lede:
      "Fort Myers generator service covers a city that has spent years replacing roofs and rethinking backup power after Hurricane Ian, along a river that floods differently than the Gulf front.",
    paragraphs: [
      "Some houses are new enough that the generator is part of the rebuild. Others are older downtown or suburban homes that rode out the storm on extension cords and do not want to do that again. Those are installation conversations: fuel, transfer switch, and a pad that respects the lot’s flood history.",
      "Units that were installed in a hurry still need maintenance. A generator put in during a rebuild and never serviced is a repair waiting for the next outage. We cover that maintenance and 24/7 repair for Fort Myers houses, and we install when standby power was never part of the original house.",
    ],
    notesTitle: "What we watch for in Fort Myers",
    notes: [
      "Rebuilds where the generator was added fast and never put on a service plan",
      "River and storm-surge lots that need an honest flood conversation",
      "Older panels downtown versus new construction in the subdivisions",
    ],
    nearby: ["naples", "sarasota", "port-st-lucie"],
  },
  sarasota: {
    description:
      "Sarasota generator service for mainland homes and barrier-island access limits. Generac installation, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Sarasota generator service splits at the bridges. Mainland neighborhoods and the keys do not share flood rules, lot sizes, or how quickly a truck can arrive.",
    paragraphs: [
      "Siesta and Lido properties deal with evacuation timing, flood elevation, and salt. A maintenance plan has to assume access may be awkward after a storm. Mainland Sarasota and the northern neighborhoods are closer to a standard Generac install, with mature trees and older homes in the mix.",
      "Generator repair is 24/7, and installation still means permits. Call (386) 631-8982 and tell us which side of the bridge the house is on.",
    ],
    notesTitle: "What we watch for in Sarasota",
    notes: [
      "Bridge access and flood elevation on the keys",
      "Older mainland homes with panels that predate a transfer switch",
      "Salt on island units that a once-a-year glance will not catch",
    ],
    nearby: ["fort-myers", "tampa", "naples"],
  },
  hollywood: {
    description:
      "Hollywood generator service between Miami and Fort Lauderdale, for beach and inland houses. Generac maintenance and 24/7 repair. (386) 631-8982.",
    lede:
      "Hollywood generator service sits between two larger cities and still has its own split: salt on the beach side, and ordinary Broward subdivisions inland.",
    paragraphs: [
      "Hollywood Lakes and the other inland neighborhoods are where a residential Generac usually fits. Beachfront condo stacks generally do not. We say that at the start so nobody prices a standby unit for a balcony. Single-family lots get a real installation scope: fuel, switch, permit.",
      "Because the city is between Miami and Fort Lauderdale, owners sometimes inherit advice written for a different housing type. Maintenance and repair follow the unit you actually have. Six-month service, Mobile Link, and a 24/7 number — (386) 631-8982 — are the offer.",
    ],
    notesTitle: "What we watch for in Hollywood",
    notes: [
      "Beach buildings that cannot host a residential standby generator",
      "Inland single-family lots that can, including lake-edge drainage",
      "Advice borrowed from Miami high-rises that does not apply to a house",
    ],
    nearby: ["miami", "fort-lauderdale", "coral-gables"],
  },
  "coral-gables": {
    description:
      "Coral Gables generator service for Mediterranean homes with strict exterior review and mature trees. Generac install and repair. (386) 631-8982.",
    lede:
      "Coral Gables generator service is an exterior-design problem wrapped around an electrical one. The city pays attention to how equipment looks, and the lots are full of mature trees.",
    paragraphs: [
      "Mediterranean houses with tile roofs and small equipment yards need a pad and a screen plan that can survive review. We do not promise a location until setbacks, exhaust, and that review are understood. The Generac itself is the familiar home standby scope: gas or propane, transfer switch, startup.",
      "Once installed, these units are easy to forget behind a wall. Maintenance is how they do not seize up under the canopy’s humidity. Repair is 24/7 if the hidden unit is the reason the house is dark. Call (386) 631-8982.",
    ],
    notesTitle: "What we watch for in Coral Gables",
    notes: [
      "Exterior review and screening before installation is scheduled",
      "Mature trees and tight yards that limit pad and exhaust options",
      "Units hidden by walls that owners stop exercising",
    ],
    nearby: ["miami", "hollywood", "fort-lauderdale"],
  },
  "pompano-beach": {
    description:
      "Pompano Beach generator service for houses west of the intracoastal and a coastline of condos that often cannot take one. (386) 631-8982.",
    lede:
      "Pompano Beach generator service is mostly west of the condo line: single-family houses where a Generac can sit on a pad, not a cabana deck.",
    paragraphs: [
      "The beachfront is towers and associations. We will tell you quickly if a standby generator is the wrong product. Inland, north Broward lots can take an installation, and they still live with salt air that drifts farther than the A1A addresses. Maintenance has to look for that corrosion.",
      "Fishing-town storms and ordinary feeder faults both show up as no-start calls. Those are 24/7 repairs. New installations go through the estimate form so we can confirm fuel and yard before talking price.",
    ],
    notesTitle: "What we watch for in Pompano Beach",
    notes: [
      "Condos that should not be quoted as residential standby jobs",
      "Inland houses that still collect salt on the enclosure",
      "Yard access for a pad without blocking the only side setback",
    ],
    nearby: ["fort-lauderdale", "boca-raton", "hollywood"],
  },
  jupiter: {
    description:
      "Jupiter generator service for inlet neighborhoods and western Palm Beach communities. Generac installation, maintenance, and 24/7 repair. (386) 631-8982.",
    lede:
      "Jupiter generator service covers the inlet and the western communities that grew up around it, a northern Palm Beach County market with bigger lots than the condo coast.",
    paragraphs: [
      "Near the inlet, flood and wind drive the pad conversation. Farther west, newer communities have more yard and stricter boards. Both can be a clean Generac installation when the fuel is settled — gas where the main exists, propane where it does not. We do not use a beach-condo template on either.",
      "Owners here often already have a generator that was installed with the house and never put on a maintenance plan. That is the six-month visit. If it failed in the last tropical system, call (386) 631-8982 for repair rather than waiting on a builder warranty conversation that may already be over.",
    ],
    notesTitle: "What we watch for in Jupiter",
    notes: [
      "Inlet flood planning versus western community architectural rules",
      "Builder-installed units that never received an oil service",
      "Propane on lots the gas main never reached",
    ],
    nearby: ["west-palm-beach", "boca-raton", "port-st-lucie"],
  },
  "port-st-lucie": {
    description:
      "Port St. Lucie generator service on larger Treasure Coast lots along the St. Lucie River corridor. Generac install and 24/7 repair. (386) 631-8982.",
    lede:
      "Port St. Lucie generator service is a large-lot suburban city, not a beach town. There is usually room for a pad; the questions are fuel, river flood, and a panel that grew with the house.",
    paragraphs: [
      "St. Lucie County subdivisions give technicians more side yard than Coral Gables or a Daytona beach lot. That does not make installation automatic. Some streets are on propane, some on gas, and lots nearer the river need a flood conversation the western tracts do not. We split those before ordering.",
      "Growth brought a lot of first standby generators into garages’ worth of “we will schedule service later.” Later is the maintenance plan. Generator repair is still 24/7 when later already arrived as an outage. Reach us at (386) 631-8982 or through the estimate page.",
    ],
    notesTitle: "What we watch for in Port St. Lucie",
    notes: [
      "Roomy lots that still differ by fuel and river floodplain",
      "First-time owners with no maintenance habit yet",
      "Panels that were expanded as the house added pools or workshops",
    ],
    nearby: ["jupiter", "fort-myers", "west-palm-beach"],
  },
};
