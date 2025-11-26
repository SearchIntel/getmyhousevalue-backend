const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// --- CONFIGURATION ---
// We will set these in the Render dashboard so they stay secret!
const EPC_USER = process.env.EPC_USER; 
const EPC_KEY = process.env.EPC_KEY;

// Helper to encode your credentials for the Government API
const getAuthHeader = () => {
    if (!EPC_USER || !EPC_KEY) return null;
    const str = `${EPC_USER}:${EPC_KEY}`;
    return `Basic ${Buffer.from(str).toString('base64')}`;
};

// --- ROUTE: GET PROPERTIES ---
app.get('/api/properties', async (req, res) => {
  const { postcode } = req.query;
  
  if (!postcode) return res.status(400).json({ error: "Postcode required" });

  console.log(`Searching for: ${postcode}`);

  try {
    // 1. Fetch Sold Data from Land Registry (Open Data - SPARQL)
    // We fetch the top 50 most recent sales in that postcode
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
        ?addr lrcommon:postcode "${postcode.toUpperCase().replace(/\s/g, '')}"^^xsd:string .
        OPTIONAL { ?addr lrcommon:paon ?paon }
        OPTIONAL { ?addr lrcommon:saon ?saon }
        OPTIONAL { ?addr lrcommon:street ?street }
      } ORDER BY DESC(?date) LIMIT 50
    `;

    const landRegUrl = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
    const landRegResponse = await axios.get(landRegUrl);
    const sales = landRegResponse.data.results.bindings;

    // 2. Fetch EPC Data (To get sq meters)
    let epcData = [];
    const authHeader = getAuthHeader();
    
    if (authHeader) {
        try {
            const epcUrl = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${postcode.replace(/\s/g, '')}`;
            const epcRes = await axios.get(epcUrl, {
                headers: { 
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });
            epcData = epcRes.data.rows || [];
        } catch (err) {
            console.log("EPC Fetch Failed (Check API Key):", err.message);
        }
    } else {
        console.log("Skipping EPC fetch: No credentials provided.");
    }

    // 3. Merge Data
    const results = sales.map((sale, index) => {
       const paon = sale.paon ? sale.paon.value : '';
       const saon = sale.saon ? sale.saon.value : '';
       const street = sale.street ? sale.street.value : '';
       const addressString = `${saon} ${paon} ${street}`.trim();
       
       // Try to find matching EPC data for square meters
       const match = epcData.find(e => e['address'].includes(paon) || e['address1'].includes(paon));
       
       return {
         id: `prop_${index}_${Date.now()}`,
         address: addressString || "Unknown Address",
         city: "London", // In a full app, we'd fetch the city too
         postcode: postcode.toUpperCase(),
         type: sale.type.value,
         lastSoldPrice: parseInt(sale.price.value),
         lastSoldDate: sale.date.value,
         sqMeters: match ? parseInt(match['total-floor-area']) : 90, // Default to 90 if no EPC found
         epc: match ? match['current-energy-rating'] : 'N/A'
       };
    });

    res.json(results);

  } catch (error) {
    console.error("Server Error:", error.message);
    res.status(500).json({ error: "Failed to fetch property data" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
