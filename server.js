const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// --- CONFIGURATION ---
const EPC_USER = process.env.EPC_USER; 
const EPC_KEY = process.env.EPC_KEY;

// Debug logging (Masked for safety)
console.log("Starting Server...");
if (EPC_USER) console.log(`EPC User loaded: ${EPC_USER}`);
if (EPC_KEY) console.log(`EPC Key loaded: ${EPC_KEY.substring(0, 4)}...`);

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

  const cleanPostcode = postcode.toUpperCase().replace(/\s/g, '');
  console.log(`Searching for: ${cleanPostcode}`);

  try {
    // 1. Fetch Sold Data (Land Registry)
    const sparqlQuery = `
      prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      prefix xsd: <http://www.w3.org/2001/XMLSchema#>
      prefix lrppi: <http://landregistry.data.gov.uk/def/ppi/>
      prefix lrcommon: <http://landregistry.data.gov.uk/def/common/>

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

    const landRegUrl = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
    const landRegResponse = await axios.get(landRegUrl);
    
    // Check if Land Registry returned anything
    const sales = landRegResponse.data.results.bindings;
    console.log(`Land Registry found ${sales.length} records.`);

    // 2. Fetch EPC Data (Sq Meters) - "Fail Safe" mode
    let epcData = [];
    const authHeader = getAuthHeader();
    
    if (authHeader) {
        try {
            const epcUrl = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${cleanPostcode}`;
            const epcRes = await axios.get(epcUrl, {
                headers: { 
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });
            epcData = epcRes.data.rows || [];
            console.log(`EPC API found ${epcData.length} records.`);
        } catch (err) {
            // Log the specific error status to help debugging
            console.log(`EPC Fetch Warning: ${err.response ? err.response.status : err.message}`);
            // Do NOT crash. Just continue with empty EPC data.
        }
    }

    // 3. Merge Data
    const results = sales.map((sale, index) => {
       const paon = sale.paon ? sale.paon.value : '';
       const saon = sale.saon ? sale.saon.value : '';
       const street = sale.street ? sale.street.value : '';
       const addressString = `${saon} ${paon} ${street}`.trim();
       
       // Fuzzy match logic
       const match = epcData.find(e => 
           (e['address'] && e['address'].includes(paon)) || 
           (e['address1'] && e['address1'].includes(paon))
       );
       
       return {
         id: `prop_${index}_${Date.now()}`,
         address: addressString || "Unknown Address",
         city: "London", 
         postcode: postcode.toUpperCase(),
         type: sale.type.value,
         lastSoldPrice: parseInt(sale.price.value),
         lastSoldDate: sale.date.value,
         sqMeters: match ? parseInt(match['total-floor-area']) : 90, 
         epc: match ? match['current-energy-rating'] : 'N/A'
       };
    });

    res.json(results);

  } catch (error) {
    console.error("Critical Server Error:", error.message);
    // Return empty array instead of 500 error so frontend handles it gracefully
    res.json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
