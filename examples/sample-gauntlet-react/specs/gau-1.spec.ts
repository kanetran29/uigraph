import { test, expect } from '@playwright/test'

test('AC2: Clear filter empties the product id input', async ({ page }) => {
  await page.goto('/products')
  const input = page.getByLabel('Product id')
  await expect(input).toHaveValue('widget-1')
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(input).toHaveValue('')
})
