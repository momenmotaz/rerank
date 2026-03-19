// Using native fetch available in Node 18+

async function testRerank() {
  const query = "What is the capital of France?";
  const documents = [
    { id: "1", text: "Paris is the capital and most populous city of France." },
    { id: "2", text: "The Eiffel Tower is located in Paris." },
    { id: "3", text: "Lyon is another major city in France." },
    { id: "4", text: "The weather in London is usually rainy." }
  ];

  console.log("Testing /api/health...");
  const healthRes = await fetch('http://localhost:4000/api/health');
  const healthData = await healthRes.json();
  console.log("Health Check Response:", JSON.stringify(healthData, null, 2));

  if (healthData.status !== 'ready') {
    console.log("Model not ready yet, waiting...");
    return;
  }

  console.log("\nTesting /api/rerank...");
  const rerankRes = await fetch('http://localhost:4000/api/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, documents, top_k: 4 })
  });

  const rerankData = await rerankRes.json();
  console.log("Rerank Response:", JSON.stringify(rerankData, null, 2));
}

// Note: node-fetch needs to be installed or use global fetch in Node 18+
// For this test, I'll assume Node 18+ or I'll use node-fetch if needed.
// Wait, I didn't install node-fetch. I'll use native fetch if available.
testRerank().catch(console.error);
