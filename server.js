const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// --- CONFIGURATION ---
const EPC_USER = process.env.EPC_USER; 
const EPC_KEY = process.env.EPC_KEY;

// Helper to encode credentials
const getAuthHeader = () => {
    if (!EPC_USER || !EPC_KEY) return null;
    const str = `${EPC_USER}:${EPC_KEY}`;
    return `Basic ${Buffer.from(str).toString('base64')}`;
};

// --- ROUTE: GET PROPERTIES ---
app.get('/api/properties', async (req, res) => {
  const { postcode } = req.query;
  
  if (!postcode) return res.status(400).json({ error: "Postcode required" });

  const cleanPostcode = postcode.toUpperCase().replace(/\s+/g, ' ').trim(); 
  console.log(`Searching for: ${cleanPostcode}`);

  try {
    // 1. Fetch Land Registry Data (Exact Match Only)
    // We stick to exact match to avoid long timeouts
    let sales = [];
    try {
        let sparqlQuery = `
          prefix lrcommon: <http://landregistry.data.gov.uk/def/common/>
          prefix lrppi: <http://landregistry.data.gov.uk/def/ppi/>
          prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
          prefix xsd: <http://www.w3.org/2001/XMLSchema#>

          SELECT ?date ?price ?paon ?saon ?street ?type WHERE {
            ?transx lrppi:pricePaid ?price ;
                    lrppi:transactionDate ?date ;
                    lrppi:propertyType ?typeRef ;
                    lrppi:propertyAddress ?addr .
            ?typeRef rdfs:label ?type .
            ?addr lrcommon:postcode "${cleanPostcode}"^^xsd:string .
            OPTIONAL { ?addr lrcommon:paon ?paon }
            OPTIONAL { ?addr lrcommon:saon ?saon }
            OPTIONAL { ?addr lrcommon:street ?street }
          } ORDER BY DESC(?date) LIMIT 50
        `;

        let landRegUrl = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
        let landRegResponse = await axios.get(landRegUrl, { timeout: 8000 });
        sales = landRegResponse.data.results.bindings;
    } catch (err) {
        console.log("Land Registry fetch failed/timed out.");
    }

    console.log(`Land Registry found ${sales.length} records.`);

    // 2. Fetch EPC Data
    let epcData = [];
    const authHeader = getAuthHeader();
    if (authHeader) {
        try {
            // Remove space for EPC API as it is more robust that way usually
            const epcUrl = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${cleanPostcode.replace(/\s/g, '')}`;
            const epcRes = await axios.get(epcUrl, {
                headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                timeout: 3000
            });
            epcData = epcRes.data.rows || [];
            console.log(`EPC API found ${epcData.length} records.`);
        } catch (err) {
            console.log("EPC Fetch skipped/failed.");
        }
    }

    // 3. Format Data
    let results = [];

    if (sales.length > 0) {
        // Option A: Real Sales Data
        results = sales.map((sale, index) => {
           const paon = sale.paon ? sale.paon.value : '';
           const saon = sale.saon ? sale.saon.value : '';
           const street = sale.street ? sale.street.value : '';
           const addressString = `${saon} ${paon} ${street}`.trim();
           
           const match = epcData.find(e => 
               (e['address'] && e['address'].includes(paon)) || 
               (e['address1'] && e['address1'].includes(paon))
           );
           
           return {
             id: `prop_${index}_${Date.now()}`,
             address: addressString || "Unknown Address",
             city: "London", 
             postcode: cleanPostcode,
             type: sale.type.value,
             lastSoldPrice: parseInt(sale.price.value),
             lastSoldDate: sale.date.value,
             sqMeters: match ? parseInt(match['total-floor-area']) : 90, 
             epc: match ? match['current-energy-rating'] : 'N/A'
           };
        });
    } else if (epcData.length > 0) {
        // Option B: Fallback (EPC only)
        // We set a "null" sold date so the frontend knows to treat it differently
        console.log("Using EPC data as fallback...");
        results = epcData.map((prop, index) => ({
             id: `epc_${index}_${Date.now()}`,
             address: prop.address,
             city: prop['posttown'] || "London",
             postcode: cleanPostcode,
             type: prop['property-type'] || "Unknown",
             lastSoldPrice: 0, 
             lastSoldDate: null, // Send NULL instead of a fake date
             sqMeters: parseInt(prop['total-floor-area']),
             epc: prop['current-energy-rating']
        }));
    }

    res.json(results);

  } catch (error) {
    console.error("Backend Error:", error.message);
    res.json([]); 
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
