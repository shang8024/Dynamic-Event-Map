"""Keep manual CD permissions narrow without needing the instance ARN UUID."""
import json
from pathlib import Path
import unittest


POLICIES = Path(__file__).resolve().parents[3] / "infra" / "iam"
TRUSTED_SUBJECT = (
    "repo:shang8024@58407413/Dynamic-Event-Map@1428572153:environment:production"
)
TARGET_TAG = "GITHUB_OWNER/GITHUB_REPOSITORY:LIGHTSAIL_INSTANCE_NAME"


def load_policy(name):
    return json.loads((POLICIES / name).read_text(encoding="utf-8"))


class DeployPolicyGuardrails(unittest.TestCase):
    def test_trust_requires_exact_repository_identity_and_production_environment(self):
        policy = load_policy("github-deploy-trust.example.json")
        self.assertEqual(policy["Version"], "2012-10-17")
        self.assertEqual(len(policy["Statement"]), 1)
        statement = policy["Statement"][0]
        self.assertEqual(statement["Effect"], "Allow")
        self.assertEqual(statement["Action"], "sts:AssumeRoleWithWebIdentity")
        self.assertEqual(statement["Principal"], {
            "Federated": (
                "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
            )
        })
        self.assertEqual(statement["Condition"], {"StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": TRUSTED_SUBJECT,
        }})

    def test_access_and_firewall_mutations_require_the_operator_assigned_target_tag(self):
        policy = load_policy("github-deploy-permissions.example.json")
        self.assertEqual(policy["Version"], "2012-10-17")
        self.assertEqual(len(policy["Statement"]), 2)
        statement = policy["Statement"][0]
        self.assertEqual(statement["Effect"], "Allow")
        self.assertEqual(set(statement["Action"]), {
            "lightsail:GetInstanceAccessDetails",
            "lightsail:OpenInstancePublicPorts",
            "lightsail:CloseInstancePublicPorts",
        })
        self.assertEqual(statement["Resource"],
                         "arn:aws:lightsail:AWS_REGION:AWS_ACCOUNT_ID:Instance/*")
        self.assertEqual(statement["Condition"], {"StringEquals": {
            "aws:RequestedRegion": "AWS_REGION",
            "aws:ResourceTag/GitHubDeployTarget": TARGET_TAG,
        }})

    def test_only_instance_and_firewall_inspection_use_a_wildcard_resource(self):
        # AWS does not support an instance resource or resource-tag condition
        # for these two reads. Neither grants writes or temporary credentials.
        policy = load_policy("github-deploy-permissions.example.json")
        statement = policy["Statement"][1]
        self.assertEqual(statement["Effect"], "Allow")
        self.assertEqual(set(statement["Action"]), {
            "lightsail:GetInstance",
            "lightsail:GetInstancePortStates",
        })
        self.assertEqual(statement["Resource"], "*")
        self.assertEqual(statement["Condition"], {"StringEquals": {
            "aws:RequestedRegion": "AWS_REGION",
        }})

    def test_cd_role_cannot_expand_its_own_target_tags_or_replace_all_firewall_rules(self):
        policy = load_policy("github-deploy-permissions.example.json")
        actions = set()
        for statement in policy["Statement"]:
            actions.update(statement["Action"] if isinstance(statement["Action"], list)
                           else [statement["Action"]])
        self.assertEqual(actions, {
            "lightsail:GetInstance",
            "lightsail:GetInstanceAccessDetails",
            "lightsail:GetInstancePortStates",
            "lightsail:OpenInstancePublicPorts",
            "lightsail:CloseInstancePublicPorts",
        })
        self.assertNotIn("lightsail:TagResource", actions)
        self.assertNotIn("lightsail:UntagResource", actions)
        self.assertNotIn("lightsail:PutInstancePublicPorts", actions)

    def test_template_renders_for_named_target_without_an_instance_uuid(self):
        raw = (POLICIES / "github-deploy-permissions.example.json").read_text(encoding="utf-8")
        replacements = {
            "AWS_REGION": "ca-central-1",
            "AWS_ACCOUNT_ID": "123456789012",
            "GITHUB_OWNER": "shang8024",
            "GITHUB_REPOSITORY": "Dynamic-Event-Map",
            "LIGHTSAIL_INSTANCE_NAME": "eventmap-production",
        }
        for placeholder, value in replacements.items():
            raw = raw.replace(placeholder, value)
        policy = json.loads(raw)
        target = policy["Statement"][0]
        self.assertEqual(target["Resource"],
                         "arn:aws:lightsail:ca-central-1:123456789012:Instance/*")
        self.assertEqual(target["Condition"]["StringEquals"]["aws:ResourceTag/GitHubDeployTarget"],
                         "shang8024/Dynamic-Event-Map:eventmap-production")
        self.assertNotIn("LIGHTSAIL_INSTANCE_ID", raw)
        self.assertTrue(all(placeholder not in raw for placeholder in replacements))


if __name__ == "__main__":
    unittest.main()
