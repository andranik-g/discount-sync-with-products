import { useState } from "react";

import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();
  const product = responseJson.data.productCreate.product;
  const variantId = product.variants.edges[0].node.id;
  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );
  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson.data.productCreate.product,
    variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
  };
};

export default function Index() {
   const [loading, setLoading] = useState(false);

  const handleSync = async () => {
     setLoading(true);
    const res = await fetch("/api/sync-discounts"); // No need to add `/app`
       setLoading(false);
    const data = await res.json();
    console.log("Sync result:", data);
  };
  return (
    <Page>
      <TitleBar title="Discounts sync with products">
      
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
            
                <BlockStack gap="200">
             
                  <Text as="p" variant="bodyMd">
                  Click to sync current discounts with associated products. Product metafields will be updated to reflect the latest discount values
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button variant="primary" loading={loading} onClick={handleSync}>
                   Sync Discounts with Products
                  </Button>
                
                </InlineStack>
             
              </BlockStack>
            </Card>
          </Layout.Section>
         
        </Layout>
      </BlockStack>
    </Page>
  );
}



