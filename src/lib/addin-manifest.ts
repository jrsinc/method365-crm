import "server-only";
import crypto from "node:crypto";

/** Bump when the manifest changes, so Outlook picks up the new version after the admin uploads it again. */
export const ADDIN_VERSION = "1.0.0.0";

/** The same CRM address always gets the same add-in id, so uploading a newer manifest updates the add-in in place. */
function stableId(origin: string) {
  const h = crypto.createHash("sha256").update(`method365-outlook-addin:${origin}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const x = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The Outlook add-in manifest (XML, works in new and classic Outlook for Windows, Mac and Outlook on the web).
 * Buttons: "Method365 CRM" on a message being read (panel can be pinned) and on a message being written.
 */
export function addinManifest(origin: string, companyName: string) {
  const o = x(origin);
  const name = "Method365 CRM";
  const desc = x(`See who's writing in ${companyName || "the CRM"}, log emails, create leads, contacts and opportunities, and add products and quote PDFs to emails.`);

  const control = (id: string, tip: string, pin: boolean) => `
              <OfficeTab id="TabDefault">
                <Group id="${id}Group">
                  <Label resid="GroupLabel"/>
                  <Control xsi:type="Button" id="${id}Button">
                    <Label resid="ButtonLabel"/>
                    <Supertip><Title resid="ButtonLabel"/><Description resid="${tip}"/></Supertip>
                    <Icon><bt:Image size="16" resid="Icon16"/><bt:Image size="32" resid="Icon32"/><bt:Image size="80" resid="Icon80"/></Icon>
                    <Action xsi:type="ShowTaskpane"><SourceLocation resid="Taskpane"/>${pin ? "<SupportsPinning>true</SupportsPinning>" : ""}</Action>
                  </Control>
                </Group>
              </OfficeTab>`;

  const body = (pin: boolean) => `
      <Requirements><bt:Sets DefaultMinVersion="1.3"><bt:Set Name="Mailbox"/></bt:Sets></Requirements>
      <Hosts>
        <Host xsi:type="MailHost">
          <DesktopFormFactor>
            <ExtensionPoint xsi:type="MessageReadCommandSurface">${control("m365Read", "ReadTip", pin)}
            </ExtensionPoint>
            <ExtensionPoint xsi:type="MessageComposeCommandSurface">${control("m365Compose", "ComposeTip", false)}
            </ExtensionPoint>
          </DesktopFormFactor>
        </Host>
      </Hosts>
      <Resources>
        <bt:Images>
          <bt:Image id="Icon16" DefaultValue="${o}/addin/icon-16.png"/>
          <bt:Image id="Icon32" DefaultValue="${o}/addin/icon-32.png"/>
          <bt:Image id="Icon80" DefaultValue="${o}/addin/icon-80.png"/>
        </bt:Images>
        <bt:Urls><bt:Url id="Taskpane" DefaultValue="${o}/addin/taskpane.html"/></bt:Urls>
        <bt:ShortStrings>
          <bt:String id="GroupLabel" DefaultValue="Method365"/>
          <bt:String id="ButtonLabel" DefaultValue="${name}"/>
        </bt:ShortStrings>
        <bt:LongStrings>
          <bt:String id="ReadTip" DefaultValue="See the sender in the CRM, log this email, or create a lead, contact, account or opportunity from it."/>
          <bt:String id="ComposeTip" DefaultValue="Add a product table, a quote PDF or your CRM signature to this email."/>
        </bt:LongStrings>
      </Resources>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0"
           xsi:type="MailApp">
  <Id>${stableId(origin)}</Id>
  <Version>${ADDIN_VERSION}</Version>
  <ProviderName>Method365</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${name}"/>
  <Description DefaultValue="${desc}"/>
  <IconUrl DefaultValue="${o}/addin/icon-64.png"/>
  <HighResolutionIconUrl DefaultValue="${o}/addin/icon-128.png"/>
  <SupportUrl DefaultValue="${o}/addin/support.html"/>
  <AppDomains>
    <AppDomain>${o}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Mailbox"/>
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.3"/>
    </Sets>
  </Requirements>
  <FormSettings>
    <Form xsi:type="ItemRead">
      <DesktopSettings>
        <SourceLocation DefaultValue="${o}/addin/taskpane.html"/>
        <RequestedHeight>250</RequestedHeight>
      </DesktopSettings>
    </Form>
    <Form xsi:type="ItemEdit">
      <DesktopSettings>
        <SourceLocation DefaultValue="${o}/addin/taskpane.html"/>
      </DesktopSettings>
    </Form>
  </FormSettings>
  <Permissions>ReadWriteItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/>
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Edit"/>
  </Rule>
  <DisableEntityHighlighting>false</DisableEntityHighlighting>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">${body(false)}
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">${body(true)}
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
`;
}
