const DEMO: Record<string, Record<string, unknown>> = {
  "53004085616": {
    abn: "53004085616",
    entityName: "B P AUSTRALIA PTY LTD",
    status: "Active",
    statusFrom: "1999-11-01",
    gstRegistered: true,
    gstFrom: "2000-07-01",
    entityType: "Australian Private Company",
    state: "VIC",
    postcode: "3008",
    officialHistory: {
      entityNames: [{ value: "B P AUSTRALIA PTY LTD", from: "1999-11-01", to: "" }],
      abnStatuses: [{ value: "Active", from: "1999-11-01", to: "" }],
      gstRegistrations: [{ value: "Registered", from: "2000-07-01", to: "" }],
      locations: [{ value: "VIC 3008", from: "1999-11-01", to: "" }],
      entityType: "Australian Private Company",
      recordLastUpdated: "",
      retrievedAt: "",
    },
  },
  "51835430479": {
    abn: "51835430479",
    entityName: "DEPARTMENT OF INDUSTRY TOURISM AND RESOURCES",
    status: "Cancelled",
    statusFrom: "2008-10-31",
    gstRegistered: false,
    gstFrom: "",
    entityType: "Commonwealth Government Entity",
    state: "ACT",
    postcode: "2601",
    officialHistory: {
      entityNames: [{ value: "DEPARTMENT OF INDUSTRY TOURISM AND RESOURCES", from: "", to: "" }],
      abnStatuses: [{ value: "Cancelled", from: "2008-10-31", to: "" }],
      gstRegistrations: [],
      locations: [{ value: "ACT 2601", from: "", to: "" }],
      entityType: "Commonwealth Government Entity",
      recordLastUpdated: "",
      retrievedAt: "",
    },
  },
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : "";
}

function xmlBlocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1]);
}

function effectiveDate(value: string) {
  return !value || value.startsWith("0001-01-01") ? "" : value.slice(0, 10);
}

function range(block: string, value: string) {
  return { value, from: effectiveDate(xmlValue(block, "effectiveFrom")), to: effectiveDate(xmlValue(block, "effectiveTo")) };
}

function currentRange<T extends { to: string }>(items: T[]) {
  return items.find((item) => !item.to) ?? items[0];
}

export async function GET() {
  return Response.json({ configured: Boolean(clean(process.env.ABN_LOOKUP_GUID)) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { abn?: string };
    const abn = clean(body.abn).replace(/\D/g, "");
    const guid = clean(process.env.ABN_LOOKUP_GUID);
    if (!/^\d{11}$/.test(abn)) return Response.json({ error: "Invalid ABN format" }, { status: 400 });

    if (!guid) {
      const demo = DEMO[abn];
      if (!demo) {
        return Response.json({
          abn,
          entityName: "Official data not connected",
          status: "Unknown",
          statusFrom: "",
          gstRegistered: null,
          gstFrom: "",
          entityType: "",
          state: "",
          postcode: "",
          lastChecked: new Date().toISOString(),
          source: "pending",
          note: "Add an Authentication GUID to run an official lookup",
        });
      }
      return Response.json({ ...demo, lastChecked: new Date().toISOString(), source: "demo" });
    }

    const url = new URL("https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001");
    url.searchParams.set("searchString", abn);
    url.searchParams.set("includeHistoricalDetails", "Y");
    url.searchParams.set("authenticationGuid", guid);
    const upstream = await fetch(url, { headers: { Accept: "text/xml" } });
    if (!upstream.ok) throw new Error(`ABN Lookup returned ${upstream.status}`);
    const xml = await upstream.text();
    const exception = xmlValue(xml, "exceptionDescription") || xmlValue(xml, "exceptionMessage");
    if (exception) return Response.json({ error: exception }, { status: 400 });
    const entity = xmlValue(xml, "businessEntity202001") ? xml.match(/<businessEntity202001(?:\s[^>]*)?>([\s\S]*?)<\/businessEntity202001>/i)?.[1] ?? "" : "";
    if (!entity) throw new Error("Could not parse the ABN Lookup historical response");

    const entityNames = [
      ...xmlBlocks(entity, "mainName").map((block) => range(block, xmlValue(block, "organisationName"))),
      ...xmlBlocks(entity, "legalName").map((block) => range(block, [xmlValue(block, "givenName"), xmlValue(block, "otherGivenName"), xmlValue(block, "familyName")].filter(Boolean).join(" "))),
    ].filter((item) => item.value);
    const abnStatuses = xmlBlocks(entity, "entityStatus").map((block) => range(block, xmlValue(block, "entityStatusCode"))).filter((item) => item.value);
    const gstRegistrations = xmlBlocks(entity, "goodsAndServicesTax").map((block) => range(block, "Registered"));
    const locations = xmlBlocks(entity, "mainBusinessPhysicalAddress").map((block) => range(block, [xmlValue(block, "stateCode"), xmlValue(block, "postcode")].filter(Boolean).join(" "))).filter((item) => item.value);
    const entityType = xmlValue(xmlBlocks(entity, "entityType")[0] ?? "", "entityDescription");
    const currentName = currentRange(entityNames);
    const currentStatus = currentRange(abnStatuses);
    const currentGst = gstRegistrations.find((item) => !item.to);
    const currentLocation = currentRange(locations);
    const [state = "", postcode = ""] = (currentLocation?.value ?? "").split(/\s+/, 2);

    return Response.json({
      abn,
      entityName: currentName?.value ?? "",
      status: currentStatus?.value || "Unknown",
      statusFrom: currentStatus?.from ?? "",
      gstRegistered: Boolean(currentGst),
      gstFrom: currentGst?.from ?? "",
      entityType,
      state,
      postcode,
      lastChecked: new Date().toISOString(),
      source: "official",
      officialHistory: {
        entityNames,
        abnStatuses,
        gstRegistrations,
        locations,
        entityType,
        recordLastUpdated: effectiveDate(xmlValue(entity, "recordLastUpdatedDate")),
        retrievedAt: xmlValue(xml, "dateTimeRetrieved"),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ABN lookup failed" }, { status: 500 });
  }
}
