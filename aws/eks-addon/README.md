# Deploy Friendli Container as Amazon EKS Add-on

[**Friendli Container**](https://aws.amazon.com/marketplace/pp/prodview-ubylhkhrotpli) is a AWS Marketplace product of the [Friendli Container](https://friendli.ai/products/container).

We will walk you through setting up an EKS cluster, deploying Friendli Container, and provide the expected output for each step. By following these steps, you will have a working inference service successfully deployed on your EKS cluster.

> [!NOTE]
> Walking through this tutorial is easier with eksctl and AWS CLI tools. Please visit the [eksctl documentation](https://docs.aws.amazon.com/en_us/eks/latest/userguide/getting-started-eksctl.html) and [AWS CLI homepage](https://aws.amazon.com/cli/) for the installation guides.

## 1️⃣ Add GPU Node Group to your EKS Cluster

You need an active Amazon EKS cluster. To create a cluster, consult [the Amazon EKS documentation on creating an EKS cluster](https://docs.aws.amazon.com/en_us/eks/latest/userguide/create-cluster-auto.html).

> [!NOTE]
> Friendli Container EKS-addon requires Kubernetes version 1.28 or later.

When selecting the AWS region for your new EKS cluster, availability of GPU instances is one of the key factors to consider. You can check instance availability [here](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html).

| Supported NVIDIA Device | AWS EC2 Instance Type                                           |
| ----------------------- | --------------------------------------------------------------- |
| B200                    | [P6 instances](https://aws.amazon.com/ec2/instance-types/p6/)   |
| H200                    | [P5 instances](https://aws.amazon.com/ec2/instance-types/p5/)   |
| H100                    | [P5 instances](https://aws.amazon.com/ec2/instance-types/p5/)   |
| A100                    | [P4 instances](https://aws.amazon.com/ec2/instance-types/p4/)   |
| L40S                    | [G6e instances](https://aws.amazon.com/ec2/instance-types/g6e/) |
| A10G                    | [G5 instances](https://aws.amazon.com/ec2/instance-types/g5/)   |
| L4                      | [G6 instances](https://aws.amazon.com/ec2/instance-types/g6/)   |

If you’re going to use multi-GPU VM instance types, installing the NVIDIA GPU Operator is highly recommended for proper resource management. You can consult [the guide from NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/amazon-eks.html), and an example of installing a GPU operator using helm can be found [here](https://aws.amazon.com/blogs/containers/maximizing-gpu-utilization-with-nvidias-multi-instance-gpu-mig-on-amazon-eks-running-more-pods-per-gpu-for-enhanced-performance/).

The tutorial assumes the following EKS Add-ons are installed in your cluster. You can click “Get more add-ons” button in the “AWS add-ons” section to install them.

- Amazon VPC CNI
- CoreDNS
- kube-proxy
- Amazon EKS Pod Identity Agent

Now let’s add GPU Node Group to your EKS cluster.

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to create a node group in.
- Select the “Compute” tab and click “Add node group”.
- Configure the new node group by entering the name, Node IAM role, and other information. You can click “Create recommended role” to create IAM role. Click “Next”.
- On the next page, select “Amazon Linux 2023 (x86\_64) Nvidia” for AMI type.
- Select the appropriate instance type for the GPU device of your choice.
  - Suggested instance type for this tutorial is `g6.2xlarge`.
- Configure the disk size. It should be large enough to download the model you want to deploy.
  - Suggested disk size for this tutorial is 100GB.
- Configure the desired node group size.
- Go through the rest of the steps, review the changes and click “Create”.

## 2️⃣ Configure Friendli Container EKS add-on

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to configure.
- Select the “Add-ons” tab and click “Get more add-ons”.
- Scroll down and under the section “AWS Marketplace add-ons”, search and check “Friendli Container”, and click “Next”.
- Click “Next”, Review your settings, and click “Create”

> [!NOTE]
> - For the details of the pricing, check [Friendli Container on AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-ubylhkhrotpli).
> - For trials, custom offers, and inquiries, please visit [here](https://friendli.ai/contact) for contacts.

Now you need to allow the Kubernetes ServiceAccount to contact AWS Marketplace for license validation. Execute the following commands, replacing `<REGION>` with the AWS region you created the cluster and `<NAME>` with the EKS cluster name.

```sh
eksctl utils associate-iam-oidc-provider --region <REGION> --cluster <CLUSTER> --approve

eksctl create iamserviceaccount --region <REGION> --cluster <CLUSTER> \
  --namespace default --name default \
  --role-name AWSMarketplaceMeteringAccessForFriendliContainer \
  --attach-policy-arn arn:aws:iam::aws:policy/AWSMarketplaceMeteringFullAccess \
  --approve --override-existing-serviceaccounts
```

The commands above configure IAM roles for service accounts (IRSA) for the Kubernetes ServiceAccount `default` in the `default` namespace to exercise AWSMarketplaceMeteringFullAccess policy on your behalf. [Click here](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html) to learn more about IRSA.

## 3️⃣ Create Friendli Deployment

> [!NOTE]
> You need to be able to use the “kubectl” CLI tool to access your EKS cluster. Consult [this guide from AWS](https://docs.aws.amazon.com/en_us/eks/latest/userguide/create-kubeconfig.html) for more details.

> [!NOTE]
> To deploy a private or gated model in the HuggingFace model hub, you need to [create a HuggingFace access token](https://huggingface.co/settings/tokens) with “read” permission.
>
> Then create a Kubernetes secret.
>
> `kubectl create secret generic hf-secret --from-literal token=YOUR_TOKEN_HERE`

FriendliDeployment is Kubernetes custom resource that lets you easily create Friendli Inference Deployments without configuring Kubernetes low-level resources like pods, services, and deployments.

Below is a sample FriendlDeployment to deploy [Meta Llama 3.1 8b](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) on one g6.2xlarge instance.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  model:
    huggingFace:
      repository: meta-llama/Llama-3.1-8B-Instruct

      # "token:" section is not needed if the model is
      # a public one.
      token:
        name: hf-secret
        key: token

  resources:

    nodeSelector:
      # Use the name of the node group you want to use.
      eks.amazonaws.com/nodegroup: <NODE GROUP NAME>

    numGPUs: 1
    requests:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
    limits:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
  deploymentStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  service:
    inferencePort: 6000
```

You can modify this YAML file for your use case.

- The “token:” section under spec.model.huggingFace refers to the Kubernetes secret you created for storing the HuggingFace access token. If accessing your model does not require an access token, you can omit the “token:” section entirely.
- In the example above, the node selector is `eks.amazonaws.com/nodegroup: <NODE GROUP NAME>`. Replace the node selector key to match the name of your node group.
- CPU and memory resource requirements are adjusted to g6.2xlarge instance and you may need to edit those values if you used different instance type.

> [!NOTE]
> If your cluster has NVIDIA GPU Operator installed, you need to put “nvidia.com/gpu” resource in “requests:” and “limits:” section, as GPU nodes will advertise that they have “nvidia.com/gpu” resource alongside ordinary resources like “cpu” and “memory”. You can omit “numGPUs” from your FriendliDeployment.
>
> Below is the equivalent example as above for the GPU Operator-enabled cluster.

```yaml
  resources:
    nodeSelector:
      # Use the name of the node group you want to use.
      eks.amazonaws.com/nodegroup: <NODE GROUP NAME>
    requests:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
      nvidia.com/gpu: "1"
    limits:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
      nvidia.com/gpu: "1"
```

Save your YAML file as “friendlideployment.yaml”, and execute `kubectl apply -f friendlideployment.yaml`

```
$ kubectl apply -f friendlideployment.yaml
friendlideployment.friendli.ai/friendlideployment-sample created

$ kubectl get pods -n default
NAME                                         READY   STATUS    RESTARTS   AGE
friendlideployment-sample-7d7b877c77-zjgqq   2/2     Running   0          3m18s

$ kubectl get services -n default
NAME                        TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
friendlideployment-sample   ClusterIP   172.20.95.224   <none>        6000/TCP   18m
kubernetes                  ClusterIP   172.20.0.1      <none>        443/TCP    28h
```

Now you can [port-forward](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/) to the service to connect to the service from your PC.

```
$ kubectl port-forward -n default svc/friendlideployment-sample 6000
Forwarding from 127.0.0.1:6000 -> 6000
Forwarding from [::1]:6000 -> 6000
```

In another terminal, use the curl tool to send an inference request.

```
$ curl http://localhost:6000/v1/completions -H 'Content-Type: application/json' --data-raw '{"prompt": "Hi!", max_tokens: 10, stream: false}'
{"choices":[{"finish_reason":"length","index":0,"seed":15349211611234757311,"text":" I'm Alex, and I'm excited to share","tokens":[358,2846,8683,11,323,358,2846,12304,311,4430]}],"id":"cmpl-b2e4b4cba711448c847ab89d763588da","object":"text_completion","usage":{"completion_tokens":10,"prompt_tokens":3,"total_tokens":13}}
```

For more information about Friendli Container usage, check [our documentation](https://friendli.ai/docs/guides/container/introduction) and [contact us](http://friendli.ai/contact) for inquiries.

## Cleaning up

You can remove the FriendliDeployment using the kubectl CLI tool.

```
$ kubectl delete friendlideployment -n default friendlideployment-sample
friendlideployment.friendli.ai "friendlideployment-sample" deleted
```

You may also want to scale down or delete your GPU node group to avoid being charged for unused GPU instances.
