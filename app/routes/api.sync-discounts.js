import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import pLimit from "p-limit";
// export const loader = async ({ request }) => {
//   const { admin } = await authenticate.admin(request);

//   try {
//     const response = await admin.graphql(`
//   {
//     discountNodes(first: 10) {
//       edges {
//         node {
//           discount {
//             __typename
//             ... on DiscountAutomaticBasic {
//               title
//               status
//               startsAt
//               endsAt
//               customerGets {
//                 value {
//                   ... on DiscountPercentage {
//                     percentage
//                   }
//                 }
//                 items {
//                   __typename
//                   ... on DiscountProducts {
//                     products(first: 10) {
//                       edges {
//                         node {
//                           id
//                           title
//                         }
//                       }
//                     }
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     }
//   }
// `);
//     const discountsRes = await response.json();
//     const nodes = discountsRes?.data?.discountNodes?.edges;

//     if (!nodes || nodes.length === 0) {
//       console.warn("⚠️ No automatic discounts found.");
//       return json({ success: false, message: discountsRes });
//     }

//     for (const edge of nodes) {
//       const discount = edge?.node?.discount;
//       const percentage = discount?.customerGets?.value?.percentage || 0;
//       const products = discount?.customerGets?.items?.products?.edges || [];

//       for (const p of products) {
//         const productId = p?.node?.id;
//         if (!productId) continue;

//         const mutation = `
//   mutation {
//     productUpdate(input: {
//       id: "${productId}",
//       metafields: [
//       {
//         namespace: "custom",
//         key: "discount_title",
//         type: "single_line_text_field",
//         value: "${discount.title}"
//       },
//    {
//         namespace: "custom",
//         key: "discount_status",
//         type: "single_line_text_field",
//         value: "${discount.status}"
//       },
//         ]
//     }) {
//       product {
//         id
//       }
//       userErrors {
//         field
//         message
//       }
//     }
//   }
// `;
//         const result = await admin.graphql(mutation);
//         console.log(result);
//         const userErrors = result.body?.data?.productUpdate?.userErrors;
//         if (userErrors?.length) {
//           console.error("Metafield error:", userErrors);
//         }
//       }
//     }

//     return json({ success: true, message: discountsRes });
//   } catch (err) {
//     console.error("🔥 Sync failed:", JSON.stringify(err, null, 2));
//     return json(
//       { success: false, error: err?.message || "Unknown error" },
//       { status: 500 },
//     );
//   }
// };

// Helper: retry logic
async function retry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`Retry ${i + 1} due to:`, err);
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

// Helper: escape GraphQL strings
const escapeGraphQLString = (str) =>
  String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    let allDiscounts = [];
    let after = null;
    let hasNextPage = true;

    // Paginate discountNodes
    while (hasNextPage) {
      const res = await admin.graphql(`
        {
          discountNodes(first: 50${after ? `, after: \"${after}\"` : ""}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                discount {
                  ... on DiscountAutomaticBasic {
                    title
                    status
                    customerGets {
                      value { ... on DiscountPercentage { percentage } }
                      items {
                        ... on DiscountProducts {
                          products(first: 50) {
                            pageInfo { hasNextPage endCursor }
                            edges { node { id title } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `);

      const jsonRes = await res.json();
      const discountEdges = jsonRes?.data?.discountNodes?.edges || [];
      const pageInfo = jsonRes?.data?.discountNodes?.pageInfo;

      allDiscounts.push(...discountEdges);
      hasNextPage = pageInfo?.hasNextPage;
      after = pageInfo?.endCursor;
    }

    if (!allDiscounts.length) {
      console.warn("⚠️ No automatic discounts found.");
      return json({ success: false, message: "No discounts found" });
    }

    const limit = pLimit(5); // limit concurrency to 5 updates
    let updatedCount = 0;

    for (const edge of allDiscounts) {
      const discount = edge?.node?.discount;
      const percentage = discount?.customerGets?.value?.percentage || 0;
      const title = escapeGraphQLString(discount?.title);
      const status = escapeGraphQLString(discount?.status);

      const products = discount?.customerGets?.items?.products?.edges || [];

      await Promise.all(
        products.map((p) =>
          limit(() =>
            retry(async () => {
              const productId = p?.node?.id;
              if (!productId) return;

              const mutation = `
                mutation {
                  productUpdate(input: {
                    id: \"${productId}\",
                    metafields: [
                      {
                        namespace: \"custom\",
                        key: \"discount_title\",
                        type: \"single_line_text_field\",
                        value: \"${title}\"
                      },
                      {
                        namespace: \"custom\",
                        key: \"discount_status\",
                        type: \"single_line_text_field\",
                        value: \"${status}\"
                      }
                    ]
                  }) {
                    product { id }
                    userErrors { field message }
                  }
                }
              `;

              const result = await admin.graphql(mutation);
              const resultJson = await result.json();
              const errors = resultJson?.data?.productUpdate?.userErrors;

              if (!errors?.length) updatedCount++;
              else console.warn("UserErrors:", errors);
            }),
          ),
        ),
      );
    }

    return json({
      success: true,
      message: `✅ Synced ${updatedCount} products.`,
    });
  } catch (err) {
    console.error("🔥 Sync failed:", JSON.stringify(err, null, 2));
    return json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 },
    );
  }
};
