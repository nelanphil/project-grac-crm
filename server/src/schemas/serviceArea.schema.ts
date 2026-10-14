import { z } from "zod";

const citySchema = z.object({
  name: z.string().trim().min(1, "City name is required").max(80),
});

const areaSchema = z.object({
  name: z.string().trim().min(1, "Area name is required").max(80),
  cities: z.array(citySchema).max(200),
});

export const saveServiceAreasSchema = z
  .object({
    areas: z.array(areaSchema).max(50),
  })
  .superRefine((data, ctx) => {
    const areaNames = new Set<string>();
    const cityOwners = new Map<string, string>();

    data.areas.forEach((area, areaIndex) => {
      const areaKey = area.name.toLowerCase();
      if (areaNames.has(areaKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Area "${area.name}" is listed more than once.`,
          path: ["areas", areaIndex, "name"],
        });
      }
      areaNames.add(areaKey);

      area.cities.forEach((city, cityIndex) => {
        const cityKey = city.name.toLowerCase();
        const owner = cityOwners.get(cityKey);
        if (owner) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${city.name}" is already listed under ${owner}.`,
            path: ["areas", areaIndex, "cities", cityIndex, "name"],
          });
        } else {
          cityOwners.set(cityKey, area.name);
        }
      });
    });
  });

export type SaveServiceAreasInput = z.infer<typeof saveServiceAreasSchema>;
