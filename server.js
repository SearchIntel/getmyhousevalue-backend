const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// --- CONFIGURATION ---
const EPC_USER = process.env.EPC_USER; 
const EPC_KEY = process.env.EPC_KEY;

const getAuthHeader = () => {
    if (!EPC_USER || !EPC_KEY) return null;
    const str = `${EPC_USER}:${EPC_KEY}`;
    return `Basic ${Buffer.from(str).toString('base64')}`;
};

app.get('/api/properties', async (req, res) => {
  const { postcode } = req.query;
  
  if (!postcode) return res.status(400).json({ error: "Postcode required" });

  const cleanPostcode = postcode.toUpperCase().replace(/\s+/g, ' ').trim(); 
  console.log(`Searching for: ${cleanPostcode}`);

  try {
    // START PARALLEL REQUESTS
    // We launch both searches at the same time to save seconds.
    
    // 1. Land Registry Query Promise
    const landRegPromise = (async () => {
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
            let url = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
            let response = await axios.get(url, { timeout: 6000 });
            return response.data.results.bindings;
        } catch (e) {
            console.log("Land Registry Error/Timeout");
            return [];
        }
    })();

    // 2. EPC Query Promise
    const epcPromise = (async () => {
        let auth = getAuthHeader();
        if (!auth) return [];
        try {
            let url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${cleanPostcode.replace(/\s/g, '')}`;
            let response = await axios.get(url, {
                headers: { 'Authorization': auth, 'Accept': 'application/json' },
                timeout: 3000
            });
            return response.data.rows || [];
        } catch (e) {
            console.log("EPC Error/Timeout");
            return [];
        }
    })();

    // WAIT FOR BOTH TO FINISH
    const [sales, epcData] = await Promise.all([landRegPromise, epcPromise]);

    console.log(`Results: ${sales.length} sales, ${epcData.length} EPC records.`);

    // 3. Merge & Reply
    let results = [];

    if (sales.length > 0) {
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
        results = epcData.map((prop, index) => ({
             id: `epc_${index}_${Date.now()}`,
             address: prop.address,
             city: prop['posttown'] || "London",
             postcode: cleanPostcode,
             type: prop['property-type'] || "Unknown",
             lastSoldPrice: 0, 
             lastSoldDate: null, 
             sqMeters: parseInt(prop['total-floor-area']),
             epc: prop['current-energy-rating']
        }));
    }

    res.json(results);

  } catch (error) {
    console.error("Backend Critical Error:", error.message);
    res.json([]); 
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
